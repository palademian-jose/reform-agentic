import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvidenceSummary, FrameworkInfo, ProposedFilePatch, RunConfig } from "@reform/shared";
import { createUnifiedDiff } from "./diff";
import { detectFramework } from "./frameworkDetection";

const allowedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css"]);
const ignoredDirs = new Set(["node_modules", "dist", ".git", ".next", "coverage"]);

async function walk(dir: string, results: string[]) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath, results);
      continue;
    }

    if (allowedExtensions.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
}

function extractRouteCandidates(content: string) {
  const patterns = [
    /(?:href|to)\s*[:=]\s*["'`](\/[^"'`)\s]+)["'`]/g,
    /(?:navigate|push|replace)\(\s*["'`](\/[^"'`)\s]+)["'`]/g,
    /router\.(?:push|replace)\(\s*["'`](\/[^"'`)\s]+)["'`]/g,
    /path\s*[:=]\s*["'`](\/[^"'`)\s]+)["'`]/g,
  ];

  const matches: Array<{ route: string; index: number }> = [];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const route = match[1];
      if (!route || route === "/") continue;
      matches.push({
        route,
        index: match.index ?? 0,
      });
    }
  }

  return matches;
}

function getSearchNeedle(target: string, label?: string) {
  if (label && label.trim()) {
    return label.trim();
  }

  const descriptor = target.replace(/^(role|label|text):/, "");
  const parts = descriptor.split(":").filter(Boolean);
  return parts[parts.length - 1] || target;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRouteLiteral(route: string) {
  if (!route) return "/";
  const withoutOrigin = route.replace(/^https?:\/\/[^/]+/i, "");
  const withoutQuery = withoutOrigin.split(/[?#]/, 1)[0] || "/";
  const normalized = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}

function routeFileToPattern(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const routeRoots = ["src/routes/", "pages/", "app/"];
  const root = routeRoots.find((prefix) => normalized.includes(prefix));
  if (!root) return null;

  const routePath = normalized.slice(normalized.indexOf(root) + root.length);
  const withoutExtension = routePath.replace(/\.(tsx|ts|jsx|js|mdx)$/, "");
  const segments = withoutExtension.split("/").filter(Boolean);
  const normalizedSegments = segments.filter((segment) => segment !== "index" && !segment.startsWith("_"));

  const pattern =
    "/" +
    normalizedSegments
      .map((segment) => {
        if (/^\[\.\.\..+\]$/.test(segment)) {
          return ".+";
        }
        if (/^\[.+\]$/.test(segment)) {
          return "[^/]+";
        }
        return escapeRegExp(segment);
      })
      .join("/");

  return new RegExp(`^${pattern === "/" ? "" : pattern}/?$`);
}

async function collectDeclaredRoutePatterns(projectRoot: string) {
  const files: string[] = [];
  await walk(projectRoot, files);

  return files
    .map((absolutePath) => routeFileToPattern(path.relative(projectRoot, absolutePath)))
    .filter((pattern): pattern is RegExp => Boolean(pattern));
}

function isRouteBackedByProject(route: string, routePatterns: RegExp[]) {
  const normalizedRoute = normalizeRouteLiteral(route).replace(/\$\{[^}]+\}/g, "dynamic");
  return routePatterns.some((pattern) => pattern.test(normalizedRoute));
}

function extractRelevantExcerpt(content: string, needles: string[], maxLength = 4000) {
  if (content.length <= maxLength) {
    return content;
  }

  const matches = needles
    .map((needle) => needle.trim().toLowerCase())
    .filter((needle) => needle.length > 2)
    .flatMap((needle) => {
      const index = content.toLowerCase().indexOf(needle);
      return index >= 0 ? [{ index, needle }] : [];
    })
    .sort((left, right) => left.index - right.index);

  if (matches.length === 0) {
    return content.slice(0, maxLength);
  }

  const windows: Array<{ start: number; end: number }> = [];
  for (const match of matches.slice(0, 3)) {
    const start = Math.max(0, match.index - 240);
    const end = Math.min(content.length, match.index + 1760);
    const previous = windows[windows.length - 1];

    if (previous && start <= previous.end + 120) {
      previous.end = Math.max(previous.end, end);
      continue;
    }

    windows.push({ start, end });
  }

  const parts: string[] = [];
  let remaining = maxLength;

  for (const window of windows) {
    if (remaining <= 0) break;
    const slice = content.slice(window.start, Math.min(window.end, window.start + remaining));
    parts.push(window.start > 0 ? `...${slice}` : slice);
    remaining -= slice.length + 5;
  }

  return parts.join("\n...\n").slice(0, maxLength);
}

export async function inferLikelyRoutesForTarget(projectRoot: string, target: string, label?: string) {
  const files: string[] = [];
  await walk(projectRoot, files);
  const routePatterns = await collectDeclaredRoutePatterns(projectRoot);

  const needle = getSearchNeedle(target, label);
  const normalizedNeedle = needle.toLowerCase();
  const terms = normalizedNeedle.split(/\W+/).filter((term) => term.length > 2);
  const candidates = new Map<string, { route: string; filePath: string; score: number }>();

  for (const absolutePath of files) {
    const content = await readFile(absolutePath, "utf8");
    const haystack = content.toLowerCase();

    if (!haystack.includes(normalizedNeedle) && !terms.some((term) => haystack.includes(term))) {
      continue;
    }

    const routeMatches = extractRouteCandidates(content);
    if (routeMatches.length === 0) {
      continue;
    }

    const labelIndex = haystack.indexOf(normalizedNeedle);
    const termScore = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);

    for (const routeMatch of routeMatches) {
      if (!isRouteBackedByProject(routeMatch.route, routePatterns)) {
        continue;
      }

      const distanceScore =
        labelIndex >= 0 ? Math.max(0, 6 - Math.floor(Math.abs(routeMatch.index - labelIndex) / 120)) : 0;
      const score = (haystack.includes(normalizedNeedle) ? 8 : 0) + termScore + distanceScore;
      const route = routeMatch.route;
      const existing = candidates.get(route);

      if (!existing || score > existing.score) {
        candidates.set(route, {
          route,
          filePath: path.relative(projectRoot, absolutePath),
          score,
        });
      }
    }
  }

  return [...candidates.values()].sort((left, right) => right.score - left.score).slice(0, 5);
}

function scoreFile(filePath: string, content: string, config: RunConfig, evidence: EvidenceSummary) {
  const haystack = `${filePath}\n${content}`.toLowerCase();
  const terms = [
    ...config.goal.toLowerCase().split(/\W+/),
    ...evidence.consoleErrors.join(" ").toLowerCase().split(/\W+/),
    ...evidence.domNotes.join(" ").toLowerCase().split(/\W+/),
  ].filter((term) => term.length > 2);

  return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
}

export async function collectCandidateFiles(config: RunConfig, evidence: EvidenceSummary) {
  const files: string[] = [];
  await walk(config.projectRoot, files);
  const excerptNeedles = [
    config.goal,
    ...config.browserActions.map((action) => action.target),
    ...config.browserActions.map((action) => action.value ?? ""),
    ...evidence.consoleErrors,
    ...evidence.domNotes,
  ];

  const hydrated = await Promise.all(
    files.map(async (absolutePath) => {
      const content = await readFile(absolutePath, "utf8");
      return {
        absolutePath,
        relativePath: path.relative(config.projectRoot, absolutePath),
        content,
        score: scoreFile(absolutePath, content, config, evidence),
      };
    }),
  );

  return hydrated
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((file) => ({
      path: file.relativePath,
      content: extractRelevantExcerpt(file.content, excerptNeedles, 4000),
    }));
}

export async function applyProposedEdits(config: RunConfig, patches: ProposedFilePatch[]) {
  const applied: ProposedFilePatch[] = [];

  for (const patch of patches) {
    const absolutePath = path.isAbsolute(patch.filePath)
      ? patch.filePath
      : path.join(config.projectRoot, patch.filePath);
    const current = await readFile(absolutePath, "utf8");

    if (!current.includes(patch.before)) {
      throw new Error(`Expected snippet not found in ${patch.filePath}`);
    }

    const next = current.replace(patch.before, patch.after);
    await writeFile(absolutePath, next, "utf8");

    applied.push({
      ...patch,
      diff: createUnifiedDiff(patch.filePath, current, next),
    });
  }

  return applied;
}

export async function previewProposedEdits(config: RunConfig, patches: ProposedFilePatch[]) {
  const preview: ProposedFilePatch[] = [];

  for (const patch of patches) {
    const absolutePath = path.isAbsolute(patch.filePath)
      ? patch.filePath
      : path.join(config.projectRoot, patch.filePath);
    const current = await readFile(absolutePath, "utf8");

    if (!current.includes(patch.before)) {
      throw new Error(`Expected snippet not found in ${patch.filePath}`);
    }

    const next = current.replace(patch.before, patch.after);
    preview.push({
      ...patch,
      diff: createUnifiedDiff(patch.filePath, current, next),
    });
  }

  return preview;
}

export async function ensureProjectRoot(projectRoot: string) {
  const info = await stat(projectRoot);
  if (!info.isDirectory()) {
    throw new Error(`Project root is not a directory: ${projectRoot}`);
  }
}

const frameworkCache = new Map<string, FrameworkInfo | null>();

export async function scanProjectFramework(projectRoot: string): Promise<FrameworkInfo | null> {
  const cached = frameworkCache.get(projectRoot);
  if (cached !== undefined) return cached;
  const result = await detectFramework(projectRoot);
  frameworkCache.set(projectRoot, result);
  return result;
}

export const __test__ = {
  normalizeRouteLiteral,
  routeFileToPattern,
  isRouteBackedByProject,
  extractRelevantExcerpt,
};
