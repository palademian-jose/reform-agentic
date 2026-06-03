import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { __test__ } from "./project";

test("routeFileToPattern supports dynamic route segments", () => {
  const pattern = __test__.routeFileToPattern("src/routes/artist/[id]/index.tsx");
  assert.ok(pattern);
  assert.equal(pattern?.test("/artist/vicente"), true);
  assert.equal(pattern?.test("/artist/vicente/"), true);
  assert.equal(pattern?.test("/category/vicente"), false);
});

test("isRouteBackedByProject rejects routes that do not exist", () => {
  const routePatterns = [__test__.routeFileToPattern("src/routes/artist/[id]/index.tsx")].filter(Boolean) as RegExp[];
  assert.equal(__test__.isRouteBackedByProject("/artist/${id}", routePatterns), true);
  assert.equal(__test__.isRouteBackedByProject("/category/${id}", routePatterns), false);
});

test("extractRelevantExcerpt prefers matched content over file header", () => {
  const content = "header\n".repeat(800) + "Posts tab content marker\n" + "footer\n".repeat(200);
  const excerpt = __test__.extractRelevantExcerpt(content, ["Posts"], 400);

  assert.match(excerpt, /Posts tab content marker/);
  assert.ok(!excerpt.startsWith("header\nheader\nheader\nheader\nheader\nheader\nheader\nheader\n"));
});

test("extractLocalImports and rendered component names support edit-mode child traversal", () => {
  const imports = __test__.extractLocalImports(`
    import AppRoutes from "./AppRoutes";
    import { Navbar, Footer as SiteFooter } from "./layout";
    import type { User } from "./types";
  `);
  const rendered = __test__.extractRenderedComponentNames(`
    <div>
      <Navbar />
      <AppRoutes />
      <Route path="/" element={<HomePage />} />
    </div>
  `);

  assert.deepEqual(imports, [
    { source: "./AppRoutes", identifiers: ["AppRoutes"] },
    { source: "./layout", identifiers: ["Navbar", "SiteFooter"] },
    { source: "./types", identifiers: ["User"] },
  ]);
  assert.deepEqual(rendered, ["Navbar", "AppRoutes", "Route", "HomePage"]);
});

test("collectEditModeContextFiles follows rendered child components into routes and pages", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "reform-edit-context-"));
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  await mkdir(path.join(projectRoot, "src"), { recursive: true });

  await writeFile(
    path.join(projectRoot, "src/App.tsx"),
    [
      "import AppRoutes from './AppRoutes';",
      "",
      "export function App() {",
      "  return (",
      "    <div className=\"app-shell\">",
      "      <AppRoutes />",
      "    </div>",
      "  );",
      "}",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(projectRoot, "src/AppRoutes.tsx"),
    [
      "import { Routes, Route } from 'react-router-dom';",
      "import HomePage from './pages/HomePage';",
      "",
      "export default function AppRoutes() {",
      "  return <Routes><Route path='/' element={<HomePage />} /></Routes>;",
      "}",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(projectRoot, "src/pages"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "src/pages/HomePage.tsx"),
    [
      "import { Navbar } from '../components/Navbar';",
      "",
      "export default function HomePage() {",
      "  return <main><Navbar /><section>Home page</section></main>;",
      "}",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(projectRoot, "src/components"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "src/components/Navbar.tsx"),
    "export function Navbar() { return <nav>Nav</nav>; }\n",
    "utf8",
  );

  const files = await __test__.collectEditModeContextFiles({
    projectRoot,
    primaryFilePath: "src/App.tsx",
    primaryContent: await readFile(path.join(projectRoot, "src/App.tsx"), "utf8"),
    focusedSnippet: "<div className=\"app-shell\"><AppRoutes /></div>",
    element: { textContent: "Home page" },
    maxFiles: 4,
    maxDepth: 3,
  });

  assert.deepEqual(
    files.map((file) => file.path),
    ["src/AppRoutes.tsx", "src/pages/HomePage.tsx", "src/components/Navbar.tsx"],
  );
});
