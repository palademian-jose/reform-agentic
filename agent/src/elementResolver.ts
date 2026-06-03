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

function normalizeRouteLiteral(route: string) {
  if (!route) return "/";
  const withoutOrigin = route.replace(/^https?:\/\/[^/]+/i, "");
  const withoutQuery = withoutOrigin.split(/[?#]/, 1)[0] || "/";
  const normalized = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}

function findComponentDefinitionInFile(content: string, componentName: string): number | null {
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

async function findBestComponentDefinition(
  projectRoot: string,
  files: string[],
  componentName: string,
): Promise<{ filePath: string; lineNumber: number; content: string; score: number } | null> {
  let best: { filePath: string; lineNumber: number; content: string; score: number } | null = null;
  const normalizedName = componentName.toLowerCase();

  for (const absolutePath of files) {
    try {
      const content = await readFile(absolutePath, "utf-8");
      const lineNumber = findComponentDefinitionInFile(content, componentName);
      if (lineNumber === null) continue;

      const relativePath = path.relative(projectRoot, absolutePath);
      let score = 20;

      if (relativePath.toLowerCase().includes(normalizedName)) {
        score += 40;
      }

      if (componentDirPatterns.some((dir) => relativePath.includes(dir))) {
        score += 15;
      }

      if (routeDirPatterns.generic.some((dir) => relativePath.includes(dir + "/"))) {
        score -= 5;
      }

      if (/\bapp\.(tsx|ts|jsx|js)$/i.test(relativePath) || /\bmain\.(tsx|ts|jsx|js)$/i.test(relativePath)) {
        score -= 10;
      }

      if (!best || score > best.score) {
        best = { filePath: relativePath, lineNumber, content, score };
      }
    } catch {
      // Skip unreadable files.
    }
  }

  return best ? { filePath: best.filePath, lineNumber: best.lineNumber, content: best.content, score: best.score } : null;
}

async function findBestAvailableComponentDefinition(
  projectRoot: string,
  files: string[],
  componentCandidates: Array<{ name: string; bonus: number }>,
): Promise<{ filePath: string; lineNumber: number; content: string; componentName: string } | null> {
  let best: { filePath: string; lineNumber: number; content: string; componentName: string; totalScore: number } | null = null;

  for (const { name, bonus } of componentCandidates) {
    const match = await findBestComponentDefinition(projectRoot, files, name);
    if (!match) continue;

    const totalScore = match.score + bonus;
    if (!best || totalScore > best.totalScore) {
      best = {
        filePath: match.filePath,
        lineNumber: match.lineNumber,
        content: match.content,
        componentName: name,
        totalScore,
      };
    }
  }

  return best
    ? {
        filePath: best.filePath,
        lineNumber: best.lineNumber,
        content: best.content,
        componentName: best.componentName,
      }
    : null;
}

function extractReactRouterRouteComponentNames(content: string, pathname: string): string[] {
  const normalizedPath = normalizeRouteLiteral(pathname);
  const escapedPath = escapeRegExp(normalizedPath);
  const names = new Set<string>();
  const patterns = [
    new RegExp(
      `<Route\\b[^>]*path\\s*=\\s*["'\`]${escapedPath}["'\`][^>]*element\\s*=\\s*\\{\\s*<([A-Z][A-Za-z0-9_]*)\\b`,
      "g",
    ),
    new RegExp(
      `<Route\\b[^>]*element\\s*=\\s*\\{\\s*<([A-Z][A-Za-z0-9_]*)\\b[^}]*\\}\\s*[^>]*path\\s*=\\s*["'\`]${escapedPath}["'\`]`,
      "g",
    ),
    new RegExp(
      `path\\s*=\\s*["'\`]${escapedPath}["'\`][\\s\\S]{0,240}?element\\s*=\\s*\\{\\s*<([A-Z][A-Za-z0-9_]*)\\b`,
      "g",
    ),
    new RegExp(
      `path\\s*=\\s*["'\`]${escapedPath}["'\`][\\s\\S]{0,240}?Component\\s*=\\s*\\{\\s*([A-Z][A-Za-z0-9_]*)\\b`,
      "g",
    ),
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

/**
 * Find the exact line number where an element's JSX/HTML appears in the code.
 * This looks for the specific pattern of the element with its attributes and content.
 */
function findExactElementInCode(content: string, element: ElementDescriptor): number | null {
  const tag = element.tagName.toLowerCase();

  // Build search patterns for the element
  const searchPatterns: string[] = [];

  // Pattern 1: JSX self-closing or opening tag with key attributes
  // <Tag className="..." id="...">text</Tag>
  if (element.id && element.className) {
    searchPatterns.push(`<${tag}[^>]*className=["'][^"']*${escapeRegExp(element.className)}[^"']*["'][^>]*id=["'][^"']*${escapeRegExp(element.id)}["'][^>]*>`);
  } else if (element.className) {
    searchPatterns.push(`<${tag}[^>]*className=["'][^"']*${escapeRegExp(element.className)}[^"']*["'][^>]*>`);
  } else if (element.id) {
    searchPatterns.push(`<${tag}[^>]*id=["'][^"']*${escapeRegExp(element.id)}["'][^>]*>`);
  }

  // Pattern 2: With text content for common elements
  const text = element.textContent?.trim().slice(0, 50);
  if (text && text.length > 3) {
    const escapedText = escapeRegExp(text);
    searchPatterns.push(`${tag}[^>]*>${escapedText}</${tag}>`);
    // Also look for the text in attributes (e.g., children, labels)
    searchPatterns.push(`<${tag}[^>]*>${escapedText}`);
    searchPatterns.push(`>[^<]*${escapedText}[^<]*</`);
  }

  // Pattern 3: React.createElement() calls
  if (element.componentName) {
    searchPatterns.push(`React\\.createElement\\(["']${tag}["']`);
    searchPatterns.push(`createElement\\(${tag},`);
  }

  // Search for the best matching pattern
  let bestLine: number | null = null;
  let bestScore = 0;

  for (const pattern of searchPatterns) {
    try {
      const regex = new RegExp(pattern, 'g');
      let match;

      while ((match = regex.exec(content)) !== null) {
        const before = content.slice(0, match.index);
        const lineNum = (before.match(/\n/g) || []).length + 1;

        // Score the match based on context
        let score = 10;

        // Bonus if pattern includes className
        if (pattern.includes('className') && element.className) score += 15;

        // Bonus if pattern includes id
        if (pattern.includes('id=') && element.id) score += 10;

        // Bonus if pattern includes text content
        if (pattern.includes(text) && text && text.length > 5) score += 10;

        // Bonus if match is closer to the element's className
        if (element.className) {
          const contextBefore = content.slice(Math.max(0, match.index - 200), match.index + 200);
          if (contextBefore.includes(element.className)) score += 20;
        }

        // Bonus if the line is in a return statement (common in React)
        const lineStart = content.lastIndexOf('\n', match.index) + 1;
        const lineEnd = content.indexOf('\n', match.index);
        const line = content.slice(lineStart, lineEnd);
        if (line.includes('return')) score += 5;

        if (score > bestScore) {
          bestScore = score;
          bestLine = lineNum;
        }
      }
    } catch {
      // Skip invalid regex patterns
    }
  }

  return bestLine;
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

interface FocusedSourceContext {
  lineNumber: number | null;
  snippet: string;
  startLine: number | null;
  endLine: number | null;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => normalizeWhitespace(String(value || ""))).filter((value) => value.length > 0))];
}

function tokenizeIdentifier(value: string) {
  return String(value || "")
    .split(/[^A-Za-z0-9]+/)
    .flatMap((token) => token.split(/(?=[A-Z][a-z])/))
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function toPascalCase(value: string) {
  const tokens = tokenizeIdentifier(value);
  if (tokens.length === 0) return "";
  return tokens
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join("");
}

function collectComponentCandidates(element: ElementDescriptor) {
  const candidates = new Map<string, number>();

  const addCandidate = (name: string | null | undefined, bonus: number) => {
    const normalized = normalizeWhitespace(String(name || ""));
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(normalized)) return;
    const current = candidates.get(normalized) ?? Number.NEGATIVE_INFINITY;
    if (bonus > current) {
      candidates.set(normalized, bonus);
    }
  };

  addCandidate(element.componentName, 18);
  for (const parentName of element.parentComponentNames || []) {
    addCandidate(parentName, 10);
  }

  const semanticSources = [
    element.id,
    element.className,
    element.attributes.role,
    element.attributes["aria-label"],
    element.attributes["data-testid"],
    element.attributes["data-test"],
    element.attributes["data-cy"],
    element.attributes["name"],
  ];

  for (const source of semanticSources) {
    for (const token of tokenizeIdentifier(source || "")) {
      const pascalName = toPascalCase(token);
      if (pascalName.length >= 3) {
        addCandidate(pascalName, 20);
      }
    }

    const pascalName = toPascalCase(source || "");
    if (pascalName.length >= 3) {
      addCandidate(pascalName, 22);
    }
  }

  const role = (element.attributes.role || "").toLowerCase();
  const tag = element.tagName.toLowerCase();
  const classHaystack = `${element.className} ${element.id || ""}`.toLowerCase();
  if (tag === "nav" || role === "navigation" || /\bnav(bar)?\b/.test(classHaystack)) {
    addCandidate("Navbar", 28);
    addCandidate("Navigation", 24);
    addCandidate("Header", 14);
  }
  if (tag === "header" || /\bheader\b/.test(classHaystack)) {
    addCandidate("Header", 26);
    addCandidate("SiteHeader", 18);
  }
  if (tag === "footer" || /\bfooter\b/.test(classHaystack)) {
    addCandidate("Footer", 26);
    addCandidate("SiteFooter", 18);
  }

  return [...candidates.entries()]
    .map(([name, bonus]) => ({ name, bonus }))
    .sort((a, b) => b.bonus - a.bonus || a.name.localeCompare(b.name));
}

function collectElementSearchTerms(element: ElementDescriptor) {
  const classTerms = (element.className || "")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);

  const attributeTerms = Object.entries(element.attributes || {})
    .flatMap(([key, value]) => [key, value])
    .map((term) => normalizeWhitespace(String(term || "")))
    .filter((term) => term.length > 2);

  const childTexts = (element.children || [])
    .map((child) => child.textContent)
    .filter((text) => normalizeWhitespace(text).length > 2);

  const descendantTexts = (element.descendants || [])
    .map((child) => child.textContent)
    .filter((text) => normalizeWhitespace(text).length > 2);

  const textTerms = normalizeWhitespace(element.textContent || "")
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((term) => normalizeWhitespace(term))
    .filter((term) => term.length > 2);

  return uniqueStrings([
    element.id,
    element.tagName,
    element.componentName,
    ...(element.parentComponentNames || []),
    ...classTerms,
    ...attributeTerms,
    ...textTerms.slice(0, 4),
    ...childTexts.slice(0, 6),
    ...descendantTexts.slice(0, 12),
  ]);
}

function findLineNumberForIndex(content: string, index: number) {
  return (content.slice(0, index).match(/\n/g) || []).length + 1;
}

function findBestLineByTermDensity(content: string, terms: string[]) {
  const lines = content.split("\n");
  let bestLine: number | null = null;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const windowStart = Math.max(0, i - 4);
    const windowEnd = Math.min(lines.length, i + 5);
    const windowText = lines.slice(windowStart, windowEnd).join("\n").toLowerCase();
    let score = 0;

    for (const term of terms) {
      const needle = normalizeWhitespace(term).toLowerCase();
      if (!needle || needle.length < 3) continue;
      if (windowText.includes(needle)) {
        score += needle.length > 16 ? 6 : needle.length > 8 ? 4 : 2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestLine = i + 1;
    }
  }

  return bestLine;
}

function extractLikelyJsxBlock(content: string, anchorLine: number | null, tagName: string): FocusedSourceContext {
  if (!anchorLine || anchorLine <= 0) {
    return {
      lineNumber: null,
      snippet: "",
      startLine: null,
      endLine: null,
    };
  }

  const lines = content.split("\n");
  const tag = tagName.toLowerCase();
  let startLine = Math.max(1, anchorLine - 12);
  let endLine = Math.min(lines.length, anchorLine + 12);

  for (let line = anchorLine; line >= Math.max(1, anchorLine - 40); line -= 1) {
    const text = lines[line - 1] || "";
    if (new RegExp(`<${escapeRegExp(tag)}(?:\\s|>)`, "i").test(text)) {
      startLine = line;
      break;
    }
    if (/<[A-Za-z][^>]*$/.test(text) || /^\s*return\s*\(/.test(text) || /^\s*<[^/!]/.test(text)) {
      startLine = line;
    }
  }

  let depth = 0;
  let sawTag = false;
  for (let line = startLine; line <= Math.min(lines.length, startLine + 160); line += 1) {
    const text = lines[line - 1] || "";
    const openMatches = text.match(new RegExp(`<${escapeRegExp(tag)}(?:\\s|>)`, "gi")) || [];
    const closeMatches = text.match(new RegExp(`</${escapeRegExp(tag)}>`, "gi")) || [];
    const selfClosingMatches = text.match(new RegExp(`<${escapeRegExp(tag)}[^>]*\\/\\s*>`, "gi")) || [];

    if (openMatches.length > 0) {
      sawTag = true;
      depth += openMatches.length;
      depth -= selfClosingMatches.length;
    }
    if (closeMatches.length > 0) {
      depth -= closeMatches.length;
    }

    endLine = line;
    if (sawTag && depth <= 0) {
      break;
    }

    if (!sawTag && line >= anchorLine + 20 && /^\s*$/.test(text)) {
      break;
    }
  }

  const snippet = lines.slice(startLine - 1, endLine).join("\n").trim();
  return {
    lineNumber: anchorLine,
    snippet,
    startLine,
    endLine,
  };
}

function scoreElementMatch(
  projectRoot: string,
  filePath: string,
  content: string,
  element: ElementDescriptor,
  _allComponentNames: string[],
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

  for (const term of collectElementSearchTerms(element).slice(0, 18)) {
    const normalizedTerm = term.toLowerCase();
    if (normalizedTerm.length > 2 && haystack.includes(normalizedTerm)) {
      score += normalizedTerm.length > 12 ? 5 : 3;
      reasons.push(`subtree term "${term.slice(0, 40)}"`);
    }
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

  if ((element.totalDescendants || 0) > 0 && /<[A-Za-z]/.test(content)) {
    score += 4;
    reasons.push("contains render markup");
  }

  return { filePath, content, score, reason: reasons };
}

export async function resolveElementToFile(
  projectRoot: string,
  element: ElementDescriptor,
  currentUrl?: string,
): Promise<{
  filePath: string;
  lineNumber: number | null;
  content: string;
  confidence?: number;
  focusedSnippet?: string;
  focusedStartLine?: number | null;
  focusedEndLine?: number | null;
} | null> {
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
  const componentCandidates = collectComponentCandidates(element);

  // Strategy 0: Component definitions should win before page-route fallbacks.
  if (componentCandidates.length > 0) {
    const definitionMatch = await findBestAvailableComponentDefinition(projectRoot, files, componentCandidates);
    if (definitionMatch) {
      return {
        filePath: definitionMatch.filePath,
        lineNumber: definitionMatch.lineNumber,
        content: definitionMatch.content,
        confidence: definitionMatch.componentName === element.componentName ? 0.96 : 0.9,
      };
    }
  }

  // Strategy 1: Enhanced element pattern matching using the selected subtree.
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

  if (scored.length > 0) {
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const searchTerms = collectElementSearchTerms(element);
    let lineNumber: number | null = null;

    // Enhanced line number finding - search for the specific element pattern
    lineNumber = findExactElementInCode(best.content, element);

    // Fallback to component definition if exact element not found
    if (!lineNumber && element.componentName) {
      lineNumber = findComponentDefinitionInFile(best.content, element.componentName);
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
          lineNumber = findLineNumberForIndex(best.content, idx);
        }
      }
    }

    if (!lineNumber) {
      lineNumber = findBestLineByTermDensity(best.content, searchTerms);
    }

    // Calculate confidence based on score gap
    const confidence = scored.length > 1
      ? Math.min(0.9, best.score / (best.score + scored[1].score))
      : 0.5;
    const focusedContext = extractLikelyJsxBlock(best.content, lineNumber, element.tagName);

    return {
      filePath: best.filePath,
      lineNumber: focusedContext.lineNumber,
      content: best.content,
      confidence,
      focusedSnippet: focusedContext.snippet,
      focusedStartLine: focusedContext.startLine,
      focusedEndLine: focusedContext.endLine,
    };
  }

  // Strategy 2: Check files that import the nearest selected component.
  if (element.componentName) {
    const importers = await findFilesImportingComponent(projectRoot, files, element.componentName);
    if (importers.length > 0) {
      const componentDirImporter = importers.find((candidatePath) =>
        componentDirPatterns.some((dir) => candidatePath.includes(dir))
      );
      const selectedPath = componentDirImporter || importers[0];
      const content = await readFile(selectedPath, "utf-8");

      return {
        filePath: path.relative(projectRoot, selectedPath),
        lineNumber: findBestLineByTermDensity(content, collectElementSearchTerms(element)),
        content,
        confidence: componentDirImporter ? 0.5 : 0.35,
      };
    }
  }

  // Strategy 3: Route file fallback.
  if (currentUrl) {
    const routeFiles = findRouteFiles(projectRoot, currentUrl, files);
    if (routeFiles.length > 0) {
      const routePath = routeFiles[0];
      const content = await readFile(routePath, "utf-8");
      return {
        filePath: path.relative(projectRoot, routePath),
        lineNumber: findBestLineByTermDensity(content, collectElementSearchTerms(element)),
        content,
        confidence: 0.3,
      };
    }
  }

  return null;
}

export const __test__ = {
  collectElementSearchTerms,
  collectComponentCandidates,
  findBestLineByTermDensity,
  extractLikelyJsxBlock,
  findComponentDefinitionInFile,
};
