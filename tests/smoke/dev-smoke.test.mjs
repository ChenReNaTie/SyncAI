import assert from "node:assert/strict";
import test from "node:test";
import { startDevStack, waitForDevServices } from "../helpers/dev-stack.mjs";

test(
  "dev smoke starts both frontend and backend entrypoints",
  { timeout: 70000 },
  async (context) => {
    const dev = await startDevStack();
    context.after(async () => {
      await dev.stop();
    });

    try {
      const { frontendResponse, backendResponse } = await waitForDevServices({
        timeoutMs: 45000,
      });

      assert.equal(frontendResponse.status, 200);
      assert.equal(backendResponse.status, 200);

      const payload = await backendResponse.json();
      assert.equal(payload.agentType, "codex");
    } catch (error) {
      throw new Error(
        `${error.message}\nCaptured dev logs:\n${dev.logs.read() || "(no dev logs captured)"}`,
      );
    }
  },
);
