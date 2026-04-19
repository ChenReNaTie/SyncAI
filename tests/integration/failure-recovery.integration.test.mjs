import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  closePool,
  insertMessage,
  listEnumValues,
  seedSessionContext,
  withRollbackTransaction,
} from "../helpers/database.mjs";

after(async () => {
  await closePool();
});

test("integration_failure_recovery preserves failure-oriented runtime and event enums from the requirements", async () => {
  await withRollbackTransaction(async (client) => {
    const runtimeStates = await listEnumValues(client, "session_runtime_status");
    const eventTypes = await listEnumValues(client, "session_event_type");

    assert.ok(runtimeStates.includes("error"));
    assert.ok(eventTypes.includes("message.failed"));
    assert.ok(eventTypes.includes("node.status_changed"));
  });
});

test("integration_failure_recovery stores failed messages with error summaries for later recovery", async () => {
  await withRollbackTransaction(async (client) => {
    const context = await seedSessionContext(client, {
      runtimeStatus: "error",
    });

    const message = await insertMessage(client, {
      sessionId: context.sessionId,
      senderType: "member",
      senderUserId: context.ownerId,
      content: "The node is offline",
      processingStatus: "failed",
      sequenceNo: 1,
      errorSummary: "NODE_UNAVAILABLE",
    });

    assert.equal(message.processing_status, "failed");
    assert.equal(message.error_summary, "NODE_UNAVAILABLE");
  });
});
