import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv } from "../../server/dist/config/env.js";

test("server env loader keeps the repo defaults used by smoke and dev", () => {
  const env = loadEnv({});

  assert.equal(env.nodeEnv, "development");
  assert.equal(env.appName, "SyncAI");
  assert.equal(env.host, "0.0.0.0");
  assert.equal(env.port, 3001);
  assert.equal(env.databaseUrl, "postgres://syncai:syncai@127.0.0.1:5432/syncai");
  assert.equal(env.redisUrl, "redis://127.0.0.1:6380");
  assert.equal(env.codexPath, undefined);
  assert.equal(env.mockAgentLatencyMs, 25);
});

test("server env loader parses explicit numeric overrides", () => {
  const env = loadEnv({
    NODE_ENV: "test",
    SYNCAI_APP_NAME: "SyncAI Test",
    SYNCAI_SERVER_HOST: "127.0.0.1",
    SYNCAI_SERVER_PORT: "4010",
    SYNCAI_DATABASE_URL: "postgres://custom",
    SYNCAI_REDIS_URL: "redis://custom",
    SYNCAI_CODEX_PATH: "C:/tools/codex.exe",
    SYNCAI_MOCK_AGENT_LATENCY_MS: "80",
  });

  assert.equal(env.nodeEnv, "test");
  assert.equal(env.appName, "SyncAI Test");
  assert.equal(env.host, "127.0.0.1");
  assert.equal(env.port, 4010);
  assert.equal(env.databaseUrl, "postgres://custom");
  assert.equal(env.redisUrl, "redis://custom");
  assert.equal(env.codexPath, "C:/tools/codex.exe");
  assert.equal(env.mockAgentLatencyMs, 80);
});
