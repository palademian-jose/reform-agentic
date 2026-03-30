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
