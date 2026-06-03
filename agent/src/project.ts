import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvidenceSummary, FrameworkInfo, ProposedFilePatch, RunConfig } from "@reform/shared";
import { createUnifiedDiff } from "./diff";
import { detectFramework } from "./frameworkDetection";

const allowedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css"]);
const ignoredDirs = new Set(["node_modules", "dist", ".git", ".next", "coverage"]);
const codeExtensions = [".tsx", ".ts", ".jsx", ".js"];

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

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
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

function parseImportedIdentifiers(importClause: string) {
  const identifiers: string[] = [];
  const clause = importClause.trim().replace(/^type\s+/, "");

  const defaultMatch = clause.match(/^([A-Za-z_$][\w$]*)/);
  if (defaultMatch && defaultMatch[1] !== "{" && defaultMatch[1] !== "*") {
    identifiers.push(defaultMatch[1]);
  }

  const namespaceMatch = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch?.[1]) {
    identifiers.push(namespaceMatch[1]);
  }

  const namedMatch = clause.match(/\{([^}]+)\}/);
  if (namedMatch?.[1]) {
    for (const part of namedMatch[1].split(",")) {
      const cleaned = part.trim().replace(/^type\s+/, "");
      if (!cleaned) continue;
      const alias = cleaned.split(/\s+as\s+/i).pop()?.trim();
      if (alias) {
        identifiers.push(alias);
      }
    }
  }

  return [...new Set(identifiers)];
}

function extractLocalImports(content: string) {
  const imports: Array<{ source: string; identifiers: string[] }> = [];
  const pattern = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g;

  for (const match of content.matchAll(pattern)) {
    const clause = match[1]?.trim();
    const source = match[2]?.trim();
    if (!clause || !source || !source.startsWith(".")) continue;
    imports.push({
      source,
      identifiers: parseImportedIdentifiers(clause),
    });
  }

  return imports;
}

async function resolveLocalImportPath(importerAbsolutePath: string, importSource: string) {
  const basePath = path.resolve(path.dirname(importerAbsolutePath), importSource);
  const candidates = [
    basePath,
    ...codeExtensions.map((ext) => `${basePath}${ext}`),
    ...codeExtensions.map((ext) => path.join(basePath, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractRenderedComponentNames(content: string) {
  const names = new Set<string>();
  const patterns = [
    /<([A-Z][A-Za-z0-9_]*)\b/g,
    /Component\s*=\s*\{([A-Z][A-Za-z0-9_]*)\}/g,
    /element\s*=\s*\{\s*<([A-Z][A-Za-z0-9_]*)\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  }

  return [...names];
}

function collectElementNeedles(element?: {
  textContent?: string;
  componentName?: string | null;
  children?: Array<{ textContent: string }>;
  descendants?: Array<{ textContent: string }>;
}) {
  return [
    element?.componentName ?? "",
    element?.textContent ?? "",
    ...(element?.children || []).map((child) => child.textContent),
    ...(element?.descendants || []).map((descendant) => descendant.textContent),
  ].filter((value) => value && value.trim().length > 2);
}

export async function collectEditModeContextFiles(input: {
  projectRoot: string;
  primaryFilePath: string;
  primaryContent: string;
  focusedSnippet?: string;
  currentUrl?: string;
  element?: {
    textContent?: string;
    componentName?: string | null;
    children?: Array<{ textContent: string }>;
    descendants?: Array<{ textContent: string }>;
  };
  maxFiles?: number;
  maxDepth?: number;
}) {
  const primaryAbsolutePath = path.isAbsolute(input.primaryFilePath)
    ? input.primaryFilePath
    : path.join(input.projectRoot, input.primaryFilePath);
  const maxFiles = input.maxFiles ?? 6;
  const maxDepth = input.maxDepth ?? 2;
  const relatedFiles: Array<{ path: string; content: string }> = [];
  const visited = new Set<string>([primaryAbsolutePath]);
  const queue: Array<{ absolutePath: string; content: string; scopeContent: string; depth: number }> = [
    {
      absolutePath: primaryAbsolutePath,
      content: input.primaryContent,
      scopeContent: input.focusedSnippet?.trim() || input.primaryContent,
      depth: 0,
    },
  ];
  const extraNeedles = collectElementNeedles(input.element);

  while (queue.length > 0 && relatedFiles.length < maxFiles) {
    const current = queue.shift();
    if (!current) break;

    const imports = extractLocalImports(current.content);
    const importMap = new Map<string, string>();

    for (const entry of imports) {
      const resolvedImportPath = await resolveLocalImportPath(current.absolutePath, entry.source);
      if (!resolvedImportPath) continue;
      for (const identifier of entry.identifiers) {
        importMap.set(identifier, resolvedImportPath);
      }
    }

    const renderedNames = extractRenderedComponentNames(current.scopeContent);
    const fallbackNames =
      current.depth === 0 && renderedNames.length === 0
        ? [...importMap.keys()].filter((identifier) => /(route|page|screen|view|layout|content|body)/i.test(identifier))
        : [];
    const candidateNames = [...new Set([...renderedNames, ...fallbackNames])];

    for (const name of candidateNames) {
      const resolvedPath = importMap.get(name);
      if (!resolvedPath || visited.has(resolvedPath)) continue;
      visited.add(resolvedPath);

      const content = await readFile(resolvedPath, "utf8");
      const relativePath = path.relative(input.projectRoot, resolvedPath);
      relatedFiles.push({
        path: relativePath,
        content: extractRelevantExcerpt(content, [name, ...extraNeedles], 8000),
      });

      if (current.depth + 1 < maxDepth) {
        queue.push({
          absolutePath: resolvedPath,
          content,
          scopeContent: content,
          depth: current.depth + 1,
        });
      }

      if (relatedFiles.length >= maxFiles) {
        break;
      }
    }
  }

  return relatedFiles;
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

export async function applyProposedEdits(
  config: RunConfig,
  patches: ProposedFilePatch[],
): Promise<{ applied: number; skipped: number; patches: ProposedFilePatch[] }> {
  const applied: ProposedFilePatch[] = [];
  let skipped = 0;

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const absolutePath = path.isAbsolute(patch.filePath)
      ? patch.filePath
      : path.join(config.projectRoot, patch.filePath);
    const current = await readFile(absolutePath, "utf8");

    if (!current.includes(patch.before)) {
      skipped += 1;
      continue;
    }

    const next = current.replace(patch.before, patch.after);
    await writeFile(absolutePath, next, "utf8");

    applied.push({
      ...patch,
      diff: createUnifiedDiff(patch.filePath, current, next),
    });
  }

  console.log(`Applied ${applied.length} patches, skipped ${skipped} due to mismatches`);

  return { applied: applied.length, skipped, patches: applied };
}

export async function previewProposedEdits(
  config: RunConfig,
  patches: ProposedFilePatch[],
): Promise<{ applied: number; skipped: number; patches: ProposedFilePatch[] }> {
  const preview: ProposedFilePatch[] = [];
  let skipped = 0;

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const absolutePath = path.isAbsolute(patch.filePath)
      ? patch.filePath
      : path.join(config.projectRoot, patch.filePath);
    const current = await readFile(absolutePath, "utf8");

    if (!current.includes(patch.before)) {
      skipped += 1;
      continue;
    }

    const next = current.replace(patch.before, patch.after);
    preview.push({
      ...patch,
      diff: createUnifiedDiff(patch.filePath, current, next),
    });
  }

  console.log(`Previewed ${preview.length} patches, skipped ${skipped} due to mismatches`);

  return { applied: preview.length, skipped, patches: preview };
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
  collectEditModeContextFiles,
  normalizeRouteLiteral,
  routeFileToPattern,
  isRouteBackedByProject,
  extractRelevantExcerpt,
  extractRenderedComponentNames,
  extractLocalImports,
};
