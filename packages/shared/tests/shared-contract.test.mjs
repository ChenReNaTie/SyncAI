import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_TYPE,
  messageProcessingStatusValues,
  sessionEventTypeValues,
  sessionRuntimeStatusValues,
  sessionVisibilityValues,
  senderTypeValues,
  todoStatusValues,
} from "@syncai/shared";

test("shared constants expose the current codex-based contract", () => {
  assert.equal(AGENT_TYPE, "codex");
  assert.deepEqual(sessionVisibilityValues, ["shared", "private"]);
  assert.deepEqual(sessionRuntimeStatusValues, ["idle", "queued", "running", "completed", "error"]);
  assert.deepEqual(messageProcessingStatusValues, ["accepted", "queued", "running", "completed", "failed"]);
  assert.deepEqual(senderTypeValues, ["member", "agent"]);
  assert.deepEqual(todoStatusValues, ["pending", "completed"]);
  assert.deepEqual(sessionEventTypeValues, [
    "status.changed",
    "command.summary",
    "message.queued",
    "session.shared",
    "session.privatized",
    "message.failed",
    "node.status_changed",
  ]);
});
