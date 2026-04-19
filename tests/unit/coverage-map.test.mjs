import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  allCaseIds,
  documentedAutomatedGroups,
  regressionSuites,
} from "../fixtures/requirements-map.mjs";

test("the executable test manifest covers all 40 reviewed cases and documented groups", () => {
  assert.equal(allCaseIds.length, 40);
  assert.equal(new Set(allCaseIds).size, 40);

  const mappedCases = new Set(documentedAutomatedGroups.flatMap((group) => group.cases));
  for (const caseId of allCaseIds) {
    assert.ok(mappedCases.has(caseId), `${caseId} is not mapped into any documented automated group`);
  }

  const testingDoc = readFileSync("docs/测试脚本设计.md", "utf8");
  for (const group of documentedAutomatedGroups) {
    assert.match(testingDoc, new RegExp(group.id));
  }

  assert.deepEqual(regressionSuites.regression_commit_gate, [
    "smoke:env",
    "unit",
    "contracts",
    "integration",
  ]);
});
