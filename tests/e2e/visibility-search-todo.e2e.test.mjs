import assert from "node:assert/strict";
import test from "node:test";
import { startDevStack, waitForDevServices } from "../helpers/dev-stack.mjs";

test(
  "e2e_visibility_search_todo boots the dev stack and requires search plus todo routes",
  { timeout: 70000 },
  async (context) => {
    const dev = await startDevStack();
    context.after(async () => {
      await dev.stop();
    });

    await waitForDevServices({ timeoutMs: 45000 });

    const searchResponse = await fetch("http://127.0.0.1:3001/api/v1/teams/team-under-test/search?q=todo");
    assert.notEqual(searchResponse.status, 404, "Search is still missing from the end-to-end stack.");

    const todoResponse = await fetch("http://127.0.0.1:3001/api/v1/sessions/session-under-test/todos");
    assert.notEqual(todoResponse.status, 404, "Todo sidebar data is still missing from the end-to-end stack.");
  },
);
