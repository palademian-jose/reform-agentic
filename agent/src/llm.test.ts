import test from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "./llm";

test("parseProposalResponse accepts fenced JSON", () => {
  const parsed = __test__.parseProposalResponse(`\`\`\`json
{"rationale":"ok","confidence":0.8,"target_files":["src/app.tsx"],"regression_checks":[],"patches":[]}
\`\`\``);

  assert.equal(parsed.rationale, "ok");
  assert.equal(parsed.confidence, 0.8);
  assert.deepEqual(parsed.target_files, ["src/app.tsx"]);
});

test("parseProposalResponse extracts JSON from mixed model text", () => {
  const parsed = __test__.parseProposalResponse(`I apologize, but I need to be careful.

{"rationale":"fallback","confidence":0.2,"target_files":["vite.config.ts"],"regression_checks":[{"path":"/"}],"patches":[]}`);

  assert.equal(parsed.rationale, "fallback");
  assert.equal(parsed.confidence, 0.2);
  assert.deepEqual(parsed.target_files, ["vite.config.ts"]);
  assert.deepEqual(parsed.regression_checks, [{ path: "/", expectText: undefined }]);
});

test("parseProposalResponse throws a targeted error for non-JSON replies", () => {
  assert.throws(
    () => __test__.parseProposalResponse("I apologize, but I can't provide that."),
    /LLM returned non-JSON or malformed JSON/,
  );
});

test("escapeJsonControlCharsInStrings escapes raw newlines inside JSON string values", () => {
  const repaired = __test__.escapeJsonControlCharsInStrings(`{"rationale":"line one
line two","confidence":0.5,"target_files":[],"regression_checks":[],"patches":[]}`);

  assert.match(repaired, /line one\\nline two/);
  const parsed = JSON.parse(repaired);
  assert.equal(parsed.rationale, "line one\nline two");
});

test("parseProposalResponse repairs malformed JSON with raw newlines in strings", () => {
  const parsed = __test__.parseProposalResponse(`{
    "rationale":"layout update
with more detail",
    "confidence":0.7,
    "target_files":["src/App.tsx"],
    "regression_checks":[],
    "patches":[
      {
        "file_path":"src/App.tsx",
        "before":"<div>
  hello
</div>",
        "after":"<main>
  hello
</main>",
        "reason":"improve structure"
      }
    ]
  }`);

  assert.equal(parsed.confidence, 0.7);
  assert.equal(parsed.target_files[0], "src/App.tsx");
  assert.match(parsed.rationale, /layout update/);
  assert.match(parsed.patches[0]?.before || "", /<div>\n  hello\n<\/div>/);
});
