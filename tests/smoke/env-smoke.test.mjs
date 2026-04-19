import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { runCommand } from "../helpers/process.mjs";

test("env smoke exposes the documented startup and test entrypoints", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  for (const scriptName of [
    "db:up",
    "db:migrate",
    "dev",
    "test",
    "test:unit",
    "test:contracts",
    "test:integration",
    "test:e2e",
    "test:smoke",
  ]) {
    assert.equal(typeof packageJson.scripts[scriptName], "string");
  }

  const composeFile = readFileSync("docker-compose.yml", "utf8");
  assert.match(composeFile, /postgres:/);
  assert.match(composeFile, /redis:/);

  const migrations = readdirSync("server/migrations");
  assert.ok(migrations.includes("0001_initial_schema.sql"));
});

test("env smoke verifies Docker and Compose are callable before db:up", async () => {
  const dockerVersion = await runCommand("docker", ["--version"]);
  const composeVersion = await runCommand("docker", ["compose", "version"]);

  assert.match(dockerVersion.stdout, /Docker version/i);
  assert.match(composeVersion.stdout, /Docker Compose version/i);
});
