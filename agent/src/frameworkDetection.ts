import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { FrameworkInfo } from "@reform/shared";

const ignoredDirs = new Set(["node_modules", "dist", ".git", ".next", "coverage", ".svelte-kit", ".vercel", ".output", "build"]);

interface FrameworkCandidate {
  name: string;
  metaFramework: string | null;
  version: string | null;
  confidence: number;
  evidence: string[];
}

const baseFrameworkDeps: Record<string, string[]> = {
  react: ["react", "react-dom"],
  vue: ["vue"],
  angular: ["@angular/core"],
  svelte: ["svelte"],
  qwik: ["@builder.io/qwik"],
};

const metaFrameworkDeps: Record<string, { name: string; base: string; dep: string }> = {
  next: { name: "next", base: "react", dep: "next" },
  nuxt: { name: "nuxt", base: "vue", dep: "nuxt" },
  sveltekit: { name: "@sveltejs/kit", base: "svelte", dep: "@sveltejs/kit" },
  qwikcity: { name: "@qwik-city-plan", base: "qwik", dep: "@builder.io/qwik-city" },
};

const configFileMarkers: Record<string, { name: string; base: string; patterns: string[] }> = {
  next: { name: "next", base: "react", patterns: ["next.config.js", "next.config.mjs", "next.config.ts"] },
  nuxt: { name: "nuxt", base: "vue", patterns: ["nuxt.config.js", "nuxt.config.ts"] },
  angular: { name: "angular", base: "angular", patterns: ["angular.json"] },
  svelte: { name: "svelte", base: "svelte", patterns: ["svelte.config.js", "svelte.config.mjs"] },
  vue: { name: "vue", base: "vue", patterns: ["vue.config.js", "vue.config.ts"] },
  qwik: { name: "qwik", base: "qwik", patterns: ["qwik.config.ts"] },
};

const extensionMarkers: Record<string, { ext: string; base: string }> = {
  vue: { ext: ".vue", base: "vue" },
  svelte: { ext: ".svelte", base: "svelte" },
  angular: { ext: ".component.ts", base: "angular" },
  qwik: { ext: ".tsx", base: "qwik" },
};

function detectFromPackageJson(packageJson: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}): FrameworkCandidate[] {
  const allDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.peerDependencies || {}),
  };

  const candidates: FrameworkCandidate[] = [];

  // Check meta-frameworks first (they imply a base framework)
  for (const [key, meta] of Object.entries(metaFrameworkDeps)) {
    if (allDeps[meta.dep]) {
      candidates.push({
        name: meta.base,
        metaFramework: key,
        version: allDeps[meta.dep] || null,
        confidence: 0.95,
        evidence: [`Found ${meta.dep}@${allDeps[meta.dep]} in package.json`],
      });
    }
  }

  // Check base frameworks
  for (const [framework, deps] of Object.entries(baseFrameworkDeps)) {
    const found = deps.filter((dep) => allDeps[dep]);
    if (found.length > 0) {
      const existing = candidates.find((c) => c.name === framework);
      if (!existing) {
        candidates.push({
          name: framework,
          metaFramework: null,
          version: allDeps[found[0]] || null,
          confidence: found.length === deps.length ? 0.9 : 0.7,
          evidence: found.map((dep) => `Found ${dep}@${allDeps[dep]} in package.json`),
        });
      } else {
        // Upgrade existing meta-framework entry with additional evidence
        existing.evidence.push(
          ...found.map((dep) => `Found ${dep}@${allDeps[dep]} in package.json`),
        );
        existing.confidence = Math.min(1, existing.confidence + 0.05);
      }
    }
  }

  return candidates;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function detectFromFileSystem(projectRoot: string): Promise<FrameworkCandidate[]> {
  const candidates: FrameworkCandidate[] = [];

  // Check config file markers
  for (const [, marker] of Object.entries(configFileMarkers)) {
    for (const pattern of marker.patterns) {
      if (await fileExists(path.join(projectRoot, pattern))) {
        candidates.push({
          name: marker.base,
          metaFramework: marker.name !== marker.base ? marker.name : null,
          version: null,
          confidence: 0.7,
          evidence: [`Found config file: ${pattern}`],
        });
        break;
      }
    }
  }

  // Count source file extensions
  const extensionCounts: Record<string, number> = {};
  await countExtensions(projectRoot, extensionCounts);

  for (const [, marker] of Object.entries(extensionMarkers)) {
    const count = extensionCounts[marker.ext] || 0;
    if (count > 0) {
      const existing = candidates.find((c) => c.name === marker.base);
      if (existing) {
        existing.evidence.push(`Found ${count} ${marker.ext} file${count > 1 ? "s" : ""}`);
        existing.confidence = Math.min(1, existing.confidence + 0.1);
      } else {
        candidates.push({
          name: marker.base,
          metaFramework: null,
          version: null,
          confidence: count >= 3 ? 0.6 : 0.4,
          evidence: [`Found ${count} ${marker.ext} file${count > 1 ? "s" : ""}`],
        });
      }
    }
  }

  return candidates;
}

async function countExtensions(dir: string, counts: Record<string, number>, depth = 0): Promise<void> {
  if (depth > 8) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await countExtensions(fullPath, counts, depth + 1);
    } else {
      for (const marker of Object.values(extensionMarkers)) {
        if (entry.name.endsWith(marker.ext)) {
          counts[marker.ext] = (counts[marker.ext] || 0) + 1;
        }
      }
    }
  }
}

export async function detectFramework(projectRoot: string): Promise<FrameworkInfo | null> {
  // Try package.json first
  let packageJsonCandidates: FrameworkCandidate[] = [];
  try {
    const raw = await readFile(path.join(projectRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    packageJsonCandidates = detectFromPackageJson(parsed);
  } catch {
    // No package.json or invalid JSON
  }

  // Try file system markers
  const fsCandidates = await detectFromFileSystem(projectRoot);

  // Merge candidates
  const merged = new Map<string, FrameworkCandidate>();

  for (const candidate of [...packageJsonCandidates, ...fsCandidates]) {
    const existing = merged.get(candidate.name);
    if (!existing) {
      merged.set(candidate.name, { ...candidate });
    } else {
      // Merge evidence, take higher confidence, prefer package.json version
      const allEvidence = [...new Set([...existing.evidence, ...candidate.evidence])];
      const higherConfidence = Math.max(existing.confidence, candidate.confidence);
      merged.set(candidate.name, {
        ...existing,
        confidence: higherConfidence,
        evidence: allEvidence,
        version: existing.version || candidate.version,
        metaFramework: existing.metaFramework || candidate.metaFramework,
      });
    }
  }

  const all = [...merged.values()].sort((a, b) => b.confidence - a.confidence);
  const best = all[0];

  if (!best || best.confidence < 0.3) {
    return null;
  }

  return {
    name: best.name,
    metaFramework: best.metaFramework,
    version: best.version,
    confidence: Math.round(best.confidence * 100) / 100,
    evidence: best.evidence,
  };
}
