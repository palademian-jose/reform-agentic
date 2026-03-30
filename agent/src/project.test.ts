import test from "node:test";
import assert from "node:assert/strict";
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
