import assert from "node:assert/strict";
import test from "node:test";
import { startDevStack, waitForDevServices } from "../helpers/dev-stack.mjs";

test(
  "e2e_shared_collaboration boots the full dev stack and requires the collaboration session list API",
  { timeout: 70000 },
  async (context) => {
    const dev = await startDevStack();
    context.after(async () => {
      await dev.stop();
    });

    await waitForDevServices({ timeoutMs: 45000 });

    const response = await fetch("http://127.0.0.1:3001/api/v1/projects/project-under-test/sessions");

    assert.notEqual(
      response.status,
      404,
      "Shared collaboration still has no end-to-end session list API after the dev stack is up.",
    );
  },
);
