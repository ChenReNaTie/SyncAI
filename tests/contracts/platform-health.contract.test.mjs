import assert from "node:assert/strict";
import test from "node:test";
import { withInjectedApp } from "../helpers/server-app.mjs";

test("platform health contract returns the current phase metadata", async () => {
  await withInjectedApp(async (app) => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(payload.name, "SyncAI");
    assert.equal(payload.version, "0.1.0");
    assert.equal(payload.agentType, "codex");
    assert.equal(payload.stage, "phase-0");
    assert.equal(typeof payload.runtime.node, "string");
    assert.equal(typeof payload.runtime.timestamp, "string");
  });
});
