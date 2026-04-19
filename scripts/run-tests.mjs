import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const groupDefinitions = {
  unit: {
    setup: [
      ["run", "build", "--workspace", "@syncai/shared"],
      ["run", "build", "--workspace", "@syncai/server"],
    ],
    entries: ["tests/unit"],
  },
  contracts: {
    setup: [
      ["run", "build", "--workspace", "@syncai/shared"],
      ["run", "build", "--workspace", "@syncai/server"],
    ],
    entries: ["tests/contracts"],
  },
  integration: {
    entries: ["tests/integration"],
  },
  e2e: {
    entries: ["tests/e2e"],
  },
  "smoke:env": {
    entries: ["tests/smoke/env-smoke.test.mjs"],
  },
  "smoke:dev": {
    entries: ["tests/smoke/dev-smoke.test.mjs"],
  },
};

const suiteDefinitions = {
  smoke: ["smoke:env", "smoke:dev"],
  regression_commit_gate: ["smoke:env", "unit", "contracts", "integration"],
  regression_pre_release: [
    "smoke:env",
    "unit",
    "contracts",
    "integration",
    "e2e",
    "smoke:dev",
  ],
};

async function collectTestFiles(entryPath) {
  const absolutePath = resolve(repoRoot, entryPath);
  const entryStat = await stat(absolutePath);

  if (entryStat.isFile()) {
    return [absolutePath];
  }

  const files = [];
  const queue = [absolutePath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        queue.push(nextPath);
        continue;
      }

      if (entry.name.endsWith(".test.mjs")) {
        files.push(nextPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function runCommand(command, args, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `${label} exited with code ${code ?? "null"} and signal ${signal ?? "null"}`,
        ),
      );
    });
  });
}

async function runGroup(groupId) {
  const definition = groupDefinitions[groupId];

  if (!definition) {
    throw new Error(`Unknown test group: ${groupId}`);
  }

  console.log(`==> running group ${groupId}`);

  for (const args of definition.setup ?? []) {
    await runCommand(npmCommand, args, `${groupId}:setup`);
  }

  const files = [];
  for (const entry of definition.entries) {
    files.push(...(await collectTestFiles(entry)));
  }

  if (files.length === 0) {
    throw new Error(`No test files found for group ${groupId}`);
  }

  await runCommand(
    process.execPath,
    ["--test", "--test-reporter=spec", ...files],
    groupId,
  );
}

async function runSuite(suiteId) {
  const groups = suiteDefinitions[suiteId];

  if (!groups) {
    throw new Error(`Unknown test suite: ${suiteId}`);
  }

  const failures = [];

  for (const groupId of groups) {
    try {
      await runGroup(groupId);
    } catch (error) {
      failures.push({ groupId, error });
    }
  }

  if (failures.length > 0) {
    console.error("==> suite failed");
    for (const failure of failures) {
      console.error(`- ${failure.groupId}: ${failure.error.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`==> suite ${suiteId} passed`);
}

async function main() {
  const target = process.argv[2];

  if (!target) {
    throw new Error("Expected a test group or suite id");
  }

  if (groupDefinitions[target]) {
    await runGroup(target);
    return;
  }

  if (suiteDefinitions[target]) {
    await runSuite(target);
    return;
  }

  throw new Error(`Unknown test target: ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
