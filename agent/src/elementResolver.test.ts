import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { __test__, resolveElementToFile } from "./elementResolver";

test("collectElementSearchTerms includes subtree content beyond the selected node", () => {
  const terms = __test__.collectElementSearchTerms({
    tagName: "section",
    id: "hero",
    className: "hero-shell feature-grid",
    textContent: "Build faster together",
    attributes: { "data-section": "hero" },
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    componentName: "HomePage",
    parentComponentNames: ["App"],
    cssSelector: "#hero",
    children: [
      {
        tagName: "h2",
        id: null,
        className: "",
        textContent: "Build faster together",
        attributes: {},
      },
    ],
    descendants: [
      {
        tagName: "button",
        id: null,
        className: "cta",
        textContent: "Start free trial",
        depth: 2,
        attributes: { "data-cta": "trial" },
      },
    ],
    childCount: 1,
    totalDescendants: 2,
  });

  assert.ok(terms.includes("Start free trial"));
  assert.ok(terms.includes("feature-grid"));
  assert.ok(terms.includes("HomePage"));
});

test("findBestLineByTermDensity prefers the line window with matching subtree terms", () => {
  const content = [
    "export function HomePage() {",
    "  return (",
    "    <section className=\"hero-shell\">",
    "      <h1>Build faster together</h1>",
    "      <button>Start free trial</button>",
    "    </section>",
    "  );",
    "}",
  ].join("\n");

  const line = __test__.findBestLineByTermDensity(content, ["Build faster together", "Start free trial"]);
  assert.equal(line, 1);
});

test("extractLikelyJsxBlock returns the enclosing JSX subtree around the anchor line", () => {
  const content = [
    "export function HomePage() {",
    "  return (",
    "    <section className=\"hero-shell\">",
    "      <div>",
    "        <button>Start free trial</button>",
    "      </div>",
    "    </section>",
    "  );",
    "}",
  ].join("\n");

  const block = __test__.extractLikelyJsxBlock(content, 5, "section");
  assert.equal(block.startLine, 3);
  assert.equal(block.endLine, 7);
  assert.match(block.snippet, /<button>Start free trial<\/button>/);
});

test("findComponentDefinitionInFile ignores JSX usage and only matches actual definitions", () => {
  const content = [
    "import { Navbar } from './Navbar';",
    "",
    "export function HomePage() {",
    "  return <Navbar />;",
    "}",
  ].join("\n");

  assert.equal(__test__.findComponentDefinitionInFile(content, "Navbar"), null);
  assert.equal(__test__.findComponentDefinitionInFile(content, "HomePage"), 3);
});

test("resolveElementToFile prefers the navbar component definition over the page file", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "reform-resolver-"));
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  await mkdir(path.join(projectRoot, "src/pages"), { recursive: true });
  await mkdir(path.join(projectRoot, "src/components"), { recursive: true });

  await writeFile(
    path.join(projectRoot, "src/pages/HomePage.tsx"),
    [
      "import { Navbar } from '../components/Navbar';",
      "",
      "export function HomePage() {",
      "  return (",
      "    <main>",
      "      <Navbar />",
      "      <section>Home body</section>",
      "    </main>",
      "  );",
      "}",
    ].join("\n"),
    "utf-8",
  );

  await writeFile(
    path.join(projectRoot, "src/components/Navbar.tsx"),
    [
      "export function Navbar() {",
      "  return (",
      "    <nav className=\"navbar\" aria-label=\"Primary navigation\">",
      "      <a href=\"/\">Home</a>",
      "      <a href=\"/docs\">Docs</a>",
      "    </nav>",
      "  );",
      "}",
    ].join("\n"),
    "utf-8",
  );

  const resolved = await resolveElementToFile(
    projectRoot,
    {
      tagName: "nav",
      id: null,
      className: "navbar",
      textContent: "Home Docs",
      attributes: { role: "navigation", "aria-label": "Primary navigation" },
      boundingBox: { x: 0, y: 0, width: 120, height: 48 },
      componentName: "HomePage",
      parentComponentNames: ["App"],
      cssSelector: "nav.navbar",
      children: [
        {
          tagName: "a",
          id: null,
          className: "",
          textContent: "Home",
          attributes: { href: "/" },
        },
      ],
      descendants: [
        {
          tagName: "a",
          id: null,
          className: "",
          textContent: "Docs",
          depth: 1,
          attributes: { href: "/docs" },
        },
      ],
      childCount: 2,
      totalDescendants: 2,
    },
    "http://localhost:3000/",
  );

  assert.ok(resolved);
  assert.equal(resolved.filePath, "src/components/Navbar.tsx");
});
