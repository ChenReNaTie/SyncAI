export const allCaseIds = Object.freeze([
  "TC-A01",
  "TC-A02",
  "TC-A03",
  "TC-A04",
  "TC-A05",
  "TC-A06",
  "TC-A07",
  "TC-B01",
  "TC-B02",
  "TC-B03",
  "TC-B04",
  "TC-B05",
  "TC-B06",
  "TC-B07",
  "TC-C01",
  "TC-C02",
  "TC-C03",
  "TC-C04",
  "TC-C05",
  "TC-C06",
  "TC-D01",
  "TC-D02",
  "TC-D03",
  "TC-D04",
  "TC-D05",
  "TC-E01",
  "TC-E02",
  "TC-E03",
  "TC-F01",
  "TC-F02",
  "TC-F03",
  "TC-F04",
  "TC-F05",
  "TC-F06",
  "TC-F07",
  "TC-G01",
  "TC-G02",
  "TC-G03",
  "TC-G04",
  "TC-G05",
]);

export const documentedAutomatedGroups = Object.freeze([
  {
    id: "contract_session_create_visibility",
    layer: "contracts",
    cases: ["TC-A01", "TC-A02", "TC-A04", "TC-A05", "TC-A06", "TC-A07"],
  },
  {
    id: "contract_message_submit_idempotency",
    layer: "contracts",
    cases: ["TC-B07"],
  },
  {
    id: "contract_replay_scope",
    layer: "contracts",
    cases: ["TC-C04", "TC-C06", "TC-F03", "TC-F07"],
  },
  {
    id: "contract_search_scope",
    layer: "contracts",
    cases: ["TC-D01", "TC-D02", "TC-D03", "TC-D04", "TC-D05"],
  },
  {
    id: "contract_todo_and_audit",
    layer: "contracts",
    cases: ["TC-E01", "TC-E02", "TC-F02"],
  },
  {
    id: "integration_session_binding_visibility",
    layer: "integration",
    cases: [
      "TC-A01",
      "TC-A02",
      "TC-A03",
      "TC-A04",
      "TC-A05",
      "TC-A06",
      "TC-F01",
      "TC-F02",
      "TC-F03",
      "TC-F04",
      "TC-F05",
      "TC-F06",
      "TC-F07",
    ],
  },
  {
    id: "integration_dispatch_queue",
    layer: "integration",
    cases: ["TC-B01", "TC-B02", "TC-B03", "TC-B04", "TC-B05", "TC-B07"],
  },
  {
    id: "integration_execution_records",
    layer: "integration",
    cases: ["TC-C01", "TC-C02", "TC-C03", "TC-C04", "TC-C05", "TC-C06"],
  },
  {
    id: "integration_failure_recovery",
    layer: "integration",
    cases: ["TC-G01", "TC-G02", "TC-G03", "TC-G04", "TC-G05"],
  },
  {
    id: "e2e_shared_collaboration",
    layer: "e2e",
    cases: ["TC-A03", "TC-B06", "TC-C05"],
  },
  {
    id: "e2e_visibility_search_todo",
    layer: "e2e",
    cases: ["TC-A04", "TC-D04", "TC-D05", "TC-E03", "TC-F01", "TC-F05", "TC-F06"],
  },
]);

export const regressionSuites = Object.freeze({
  regression_commit_gate: ["smoke:env", "unit", "contracts", "integration"],
  regression_pre_release: [
    "smoke:env",
    "unit",
    "contracts",
    "integration",
    "e2e",
    "smoke:dev",
  ],
});

export function getDocumentedGroup(groupId) {
  const match = documentedAutomatedGroups.find((group) => group.id === groupId);

  if (!match) {
    throw new Error(`Unknown documented group: ${groupId}`);
  }

  return match;
}
