import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ElementDescriptor } from "@reform/shared";

const ignoredDirs = new Set([
  "node_modules", "dist", ".git", ".next", "coverage", ".svelte-kit",
  "build", "out", ".output", "public", "static", "assets",
  ".turbo", ".nuxt", ".cache", "server", "client", ".vercel",
]);

// Prefer source files over compiled files - higher priority first
const extensionPriority = [
  ".vue", ".svelte", // Component files (unique)
  ".tsx", ".jsx",  // JSX with types (preferred source)
  ".ts",           // Pure TypeScript
  ".js",           // Pure JS (fallback for JS-only projects)
];

// Route directory patterns by framework
const routeDirPatterns = {
  nextjs: ["app", "pages", "src/app", "src/pages"],
  remix: ["app", "routes"],
  vue: ["src/views", "src/pages", "views", "pages"],
  svelte: ["src/routes", "routes"],
  qwik: ["src/routes", "routes"],
  react: ["src/pages", "src/views", "pages", "views"],
  generic: ["pages", "views", "routes", "src/pages", "src/views", "src/routes"],
};

// Component directory patterns
const componentDirPatterns = [
  "components",
  "src/components",
  "app/components",
  "shared/components",
];

async function walk(dir: string, results: Map<string, string>) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, results);
      continue;
    }
    const ext = path.extname(entry.name);
    const priority = extensionPriority.indexOf(ext);
    if (priority >= 0) {
      const baseName = entry.name.slice(0, -ext.length);
      const existing = results.get(baseName);
      // Only store if this file has higher priority (lower index) than existing
      if (!existing || priority < extensionPriority.indexOf(path.extname(existing))) {
        results.set(baseName, fullPath);
      }
    }
  }
}

// Helper to get all files (for fallback search)
async function walkAll(dir: string, results: string[]) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAll(fullPath, results);
      continue;
    }
    const ext = path.extname(entry.name);
    if (extensionPriority.includes(ext)) {
      results.push(fullPath);
    }
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findComponentInFile(content: string, componentName: string): number | null {
  const patterns = [
    // Function/class declarations
    new RegExp(`(?:function|const|let|var|class)\\s+${escapeRegExp(componentName)}\\b`),
    // Export default
    new RegExp(`export\\s+default\\s+(?:function\\s+)?${escapeRegExp(componentName)}\\b`),
    // Named export
    new RegExp(`export\\s+(?:const|function|class)\\s+${escapeRegExp(componentName)}\\b`),
    // displayName assignment
    new RegExp(`name:\\s*['"\`]${escapeRegExp(componentName)}['"\`]`),
    new RegExp(`\\.displayName\\s*=\\s*['"\`]${escapeRegExp(componentName)}['"\`]`),
    // Arrow function with name
    new RegExp(`const\\s+${escapeRegExp(componentName)}\\s*=\\s*(?:\\([^)]*\\)|[a-zA-Z_$]\\w*)\\s*=>`),
    // React.forwardRef
    new RegExp(`const\\s+${escapeRegExp(componentName)}\\s*=\\s*React\\.forwardRef`),
    // JSX self-closing in another component
    new RegExp(`<${escapeRegExp(componentName)}(?:\\s|\\b|>|/>)`),
    // Vue component definition
    new RegExp(`name:\\s*['"\`]${escapeRegExp(componentName)}['"\`]`),
    // TypeScript interface/type with component name (common patterns)
    new RegExp(`(?:interface|type)\\s+${escapeRegExp(componentName)}Props`),
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match.index !== undefined) {
      const before = content.slice(0, match.index);
      const lineNumber = (before.match(/\n/g) || []).length + 1;
      return lineNumber;
    }
  }

  return null;
}

// Find files that import the component
async function findFilesImportingComponent(
  projectRoot: string,
  files: string[],
  componentName: string,
): Promise<string[]> {
  const importers: string[] = [];

  for (const absolutePath of files) {
    try {
      const content = await readFile(absolutePath, "utf-8");
      const relativePath = path.relative(projectRoot, absolutePath);

      // Match various import patterns
      const patterns = [
        new RegExp(`import\\s+{[^}]*\\b${escapeRegExp(componentName)}\\b`),
        new RegExp(`import\\s+${escapeRegExp(componentName)}\\s+from`),
        new RegExp(`import\\s+\\*\\s+as\\s+\\w+\\s+from\\s+['"][^'"]*${escapeRegExp(componentName)}`),
        // Vue component imports
        new RegExp(`components:\\s*{[^}]*\\b${escapeRegExp(componentName)}`),
        new RegExp(`${escapeRegExp(componentName)}:\\s*\\(\\)\\s*=>`), // Dynamic component
      ];

      for (const pattern of patterns) {
        if (pattern.test(content)) {
          importers.push(absolutePath);
          break;
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }
  return importers;
}

// Parse URL to find potential route file paths
function findRouteFiles(
  projectRoot: string,
  currentUrl: string,
  allFiles: string[],
): string[] {
  try {
    const url = new URL(currentUrl);
    const pathname = url.pathname;
    const segments = pathname.split("/").filter(Boolean);
    const candidates: string[] = [];

    // Framework-specific route patterns
    const routePatterns = [
      // Next.js App Router (app/.../page.tsx)
      ...segments.flatMap((seg, i) => {
        const routePath = segments.slice(0, i + 1).join("/");
        return [
          `app/${routePath}/page.tsx`,
          `app/${routePath}/page.ts`,
          `src/app/${routePath}/page.tsx`,
          `src/app/${routePath}/page.ts`,
        ];
      }),
      // Next.js Pages Router
      `pages${pathname === "/" ? "/index" : pathname}.tsx`,
      `pages${pathname === "/" ? "/index" : pathname}.ts`,
      `pages${pathname === "/" ? "/index" : pathname}.jsx`,
      `src/pages${pathname === "/" ? "/index" : pathname}.tsx`,
      `src/pages${pathname === "/" ? "/index" : pathname}.ts`,
      `src/pages${pathname === "/" ? "/index" : pathname}.jsx`,
      // Remix
      `app/routes${pathname === "/" ? "/index" : pathname}.tsx`,
      `app/routes${pathname === "/" ? "/index" : pathname}.ts`,
      // Vue Router
      `src/views${pathname === "/" ? "/Index" : pathname.charAt(0).toUpperCase() + pathname.slice(1)}.vue`,
      `src/pages${pathname === "/" ? "/Index" : pathname.charAt(0).toUpperCase() + pathname.slice(1)}.vue`,
      `views${pathname === "/" ? "/Index" : pathname.charAt(0).toUpperCase() + pathname.slice(1)}.vue`,
      // SvelteKit
      `src/routes${pathname}/+page.svelte`,
      `routes${pathname}/+page.svelte`,
      // Qwik City
      `src/routes${pathname === "/" ? "/index" : pathname}/index.tsx`,
      `routes${pathname === "/" ? "/index" : pathname}/index.tsx`,
      // Generic
      `src/pages${pathname === "/" ? "/index" : pathname}.tsx`,
      `pages${pathname === "/" ? "/index" : pathname}.tsx`,
    ];

    for (const pattern of routePatterns) {
      const fullPath = path.join(projectRoot, pattern);
      if (allFiles.includes(fullPath)) {
        candidates.push(fullPath);
      }
    }

    return candidates;
  } catch {
    return [];
  }
}

interface FileScore {
  filePath: string;
  content: string;
  score: number;
  reason: string[];
}

function scoreElementMatch(
  projectRoot: string,
  filePath: string,
  content: string,
  element: ElementDescriptor,
  allComponentNames: string[],
): FileScore {
  const relativePath = path.relative(projectRoot, filePath);
  const haystack = `${relativePath}\n${content}`.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  // === Directory-based scoring ===
  const isInComponentDir = componentDirPatterns.some(dir => relativePath.includes(dir));
  const isInRouteDir = Object.values(routeDirPatterns).flat().some(dir => relativePath.includes(dir + "/"));

  // Prefer component directory for component names
  if (element.componentName && isInComponentDir) {
    score += 15;
    reasons.push("component directory");
  }

  // Prefer route directory for pages
  if (isInRouteDir) {
    score += 5;
    reasons.push("route directory");
  }

  // === Component name scoring (strongest signal) ===
  if (element.componentName) {
    if (haystack.includes(element.componentName.toLowerCase())) {
      score += 30;
      reasons.push(`component name "${element.componentName}"`);
    }
    // Bonus if component name is in filename
    if (relativePath.toLowerCase().includes(element.componentName.toLowerCase())) {
      score += 20;
      reasons.push(`component name in filename`);
    }
  }

  // === Parent component names ===
  for (const parentName of element.parentComponentNames || []) {
    if (haystack.includes(parentName.toLowerCase())) {
      score += 10;
      reasons.push(`parent component "${parentName}"`);
    }
    // Higher bonus if parent component uses this component (import pattern)
    const importPattern = new RegExp(`import.*${escapeRegExp(parentName)}`, "i");
    if (importPattern.test(content)) {
      score += 8;
      reasons.push(`imports parent component`);
    }
  }

  // === Text content match ===
  const text = (element.textContent || "").trim().slice(0, 120).toLowerCase();
  if (text.length > 3 && haystack.includes(text)) {
    score += 10;
    reasons.push("text content match");
  }

  // === ID match ===
  if (element.id && haystack.includes(element.id.toLowerCase())) {
    score += 15;
    reasons.push(`id "${element.id}"`);
  }

  // === Class name terms ===
  const classes = (element.className || "").split(/\s+/).filter((c) => c.length > 2);
  for (const cls of classes.slice(0, 4)) {
    if (haystack.includes(cls.toLowerCase())) {
      score += 4;
      reasons.push(`class "${cls}"`);
    }
  }

  // === Data attributes (often used for testing/selection) ===
  for (const [key, value] of Object.entries(element.attributes)) {
    if (key.startsWith("data-")) {
      if (value && value.length > 2 && haystack.includes(value.toLowerCase())) {
        score += 12;
        reasons.push(`data attribute "${key}"`);
      } else {
        score += 5;
        reasons.push(`data attribute key "${key}"`);
      }
    } else if (!["class", "style", "data-reactid"].includes(key)) {
      if (value && value.length > 2 && haystack.includes(value.toLowerCase())) {
        score += 3;
        reasons.push(`attribute "${key}"`);
      }
    }
  }

  // === Penalties ===
  // Penalize test files
  if (/\.test\.(ts|tsx|js|jsx)$/.test(relativePath)) {
    score -= 20;
    reasons.push("test file (penalty)");
  }
  if (/\.spec\.(ts|tsx|js|jsx)$/.test(relativePath)) {
    score -= 20;
    reasons.push("spec file (penalty)");
  }
  // Penalize config files
  if (/\.config\.(ts|js|mjs)$/.test(relativePath)) {
    score -= 15;
    reasons.push("config file (penalty)");
  }
  // Penalize node_modules (shouldn't happen but just in case)
  if (relativePath.includes("node_modules")) {
    score -= 50;
    reasons.push("node_modules (penalty)");
  }

  // === File type bonus ===
  const ext = path.extname(relativePath);
  // Prefer component files for UI elements
  if ([".vue", ".svelte"].includes(ext)) {
    score += 5;
    reasons.push("component file type");
  }

  return { filePath, content, score, reason: reasons };
}

export async function resolveElementToFile(
  projectRoot: string,
  element: ElementDescriptor,
  currentUrl?: string,
): Promise<{ filePath: string; lineNumber: number | null; content: string; confidence?: number } | null> {
  // Get all source files
  const fileMap = new Map<string, string>();
  await walk(projectRoot, fileMap);
  const files = Array.from(fileMap.values());

  if (files.length === 0) {
    return null;
  }

  // Collect all component names from element
  const allComponentNames: string[] = [
    element.componentName,
    ...(element.parentComponentNames || []),
  ].filter((n): n is string => typeof n === "string");

  // Strategy 0: URL-based route detection (highest confidence if available)
  if (currentUrl) {
    const routeCandidates = findRouteFiles(projectRoot, currentUrl, files);
    if (routeCandidates.length > 0) {
      // If we have component names, check if they exist in route files
      for (const routeFile of routeCandidates) {
        const content = await readFile(routeFile, "utf-8");
        let hasComponentMatch = false;

        if (element.componentName) {
          hasComponentMatch = findComponentInFile(content, element.componentName) !== null;
        }

        // If no component match but this is the only route file, still use it
        if (hasComponentMatch || routeCandidates.length === 1) {
          const lineNumber = element.componentName
            ? findComponentInFile(content, element.componentName)
            : null;

          return {
            filePath: path.relative(projectRoot, routeFile),
            lineNumber,
            content,
            confidence: routeCandidates.length === 1 ? 0.9 : 0.7,
          };
        }
      }
    }
  }

  // Strategy 1: Direct component name match (highest confidence)
  if (element.componentName) {
    for (const absolutePath of files) {
      const content = await readFile(absolutePath, "utf-8");
      const lineNumber = findComponentInFile(content, element.componentName);
      if (lineNumber !== null) {
        // Check if this file also references parent components for extra confidence
        let hasParentReference = false;
        if (element.parentComponentNames && element.parentComponentNames.length > 0) {
          for (const parent of element.parentComponentNames) {
            if (content.includes(parent)) {
              hasParentReference = true;
              break;
            }
          }
        }

        return {
          filePath: path.relative(projectRoot, absolutePath),
          lineNumber,
          content,
          confidence: hasParentReference ? 0.95 : 0.85,
        };
      }
    }
  }

  // Strategy 2: Check files that import the component
  if (element.componentName) {
    const importers = await findFilesImportingComponent(projectRoot, files, element.componentName);
    if (importers.length > 0) {
      // Prefer files in component directories
      const componentDirImporter = importers.find(p =>
        componentDirPatterns.some(dir => p.includes(dir))
      );

      const selectedPath = componentDirImporter || importers[0];
      const content = await readFile(selectedPath, "utf-8");
      const lineNumber = findComponentInFile(content, element.componentName);

      return {
        filePath: path.relative(projectRoot, selectedPath),
        lineNumber,
        content,
        confidence: componentDirImporter ? 0.8 : 0.6,
      };
    }
  }

  // Strategy 3: Score all files by element relevance
  const scored: FileScore[] = [];

  for (const absolutePath of files) {
    const content = await readFile(absolutePath, "utf-8");
    const scoreResult = scoreElementMatch(
      projectRoot,
      absolutePath,
      content,
      element,
      allComponentNames,
    );
    if (scoreResult.score > 0) {
      scored.push(scoreResult);
    }
  }

  if (scored.length === 0) {
    return null;
  }

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  let lineNumber: number | null = null;

  // Try to find a more specific line number
  if (element.componentName) {
    lineNumber = findComponentInFile(best.content, element.componentName);
  }

  if (!lineNumber && element.id) {
    const match = best.content.match(new RegExp(`id=["'\`]${escapeRegExp(element.id)}["'\`]`));
    if (match && match.index !== undefined) {
      lineNumber = (best.content.slice(0, match.index).match(/\n/g) || []).length + 1;
    }
  }

  if (!lineNumber && element.textContent) {
    const text = element.textContent.trim().slice(0, 60);
    if (text.length > 3) {
      const idx = best.content.indexOf(text);
      if (idx >= 0) {
        lineNumber = (best.content.slice(0, idx).match(/\n/g) || []).length + 1;
      }
    }
  }

  // Calculate confidence based on score gap
  const confidence = scored.length > 1
    ? Math.min(0.9, best.score / (best.score + scored[1].score))
    : 0.5;

  return {
    filePath: best.filePath,
    lineNumber,
    content: best.content,
    confidence,
  };
}
