import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_TYPE,
  messageProcessingStatusValues,
  sessionEventTypeValues,
  sessionRuntimeStatusValues,
  sessionVisibilityValues,
  todoStatusValues,
} from "../../packages/shared/dist/index.js";

test("shared domain exports codex-only MVP vocabulary from the product docs", () => {
  assert.equal(AGENT_TYPE, "codex");
  assert.deepEqual(sessionVisibilityValues, ["shared", "private"]);
  assert.deepEqual(sessionRuntimeStatusValues, [
    "idle",
    "queued",
    "running",
    "completed",
    "error",
  ]);
});

test("shared domain exports message, replay, and todo status enums required by the reviewed test cases", () => {
  assert.deepEqual(messageProcessingStatusValues, [
    "accepted",
    "queued",
    "running",
    "completed",
    "failed",
  ]);

  assert.deepEqual(todoStatusValues, ["pending", "completed"]);

  assert.ok(sessionEventTypeValues.includes("status.changed"));
  assert.ok(sessionEventTypeValues.includes("command.summary"));
  assert.ok(sessionEventTypeValues.includes("session.shared"));
  assert.ok(sessionEventTypeValues.includes("session.privatized"));
  assert.ok(sessionEventTypeValues.includes("message.failed"));
  assert.ok(sessionEventTypeValues.includes("node.status_changed"));
});
