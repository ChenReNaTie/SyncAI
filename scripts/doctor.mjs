import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { delimiter, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const DEFAULTS = {
  SYNCAI_DATABASE_URL: "postgres://syncai:syncai@127.0.0.1:5432/syncai",
  SYNCAI_REDIS_URL: "redis://127.0.0.1:6379",
};

function quoteWindowsArg(arg) {
  const text = String(arg);
  if (!/[\s"]/u.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '\\"')}"`;
}

function resolveSpawnTarget(command, args) {
  if (process.platform === "win32" && /\.cmd$/iu.test(command)) {
    return {
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(" "),
      ],
    };
  }

  return { command, args };
}

function loadDotEnvFile() {
  const envPath = join(repoRoot, ".env");
  if (!existsSync(envPath)) {
    return {};
  }

  const parsed = {};
  const content = readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    parsed[key] = rawValue.replace(/^['"]|['"]$/gu, "");
  }

  return parsed;
}

function isNodeModulesBinPath(pathEntry) {
  const normalized = pathEntry.replace(/\\/gu, "/").toLowerCase();
  return normalized.includes("/node_modules/") && normalized.endsWith("/.bin");
}

function isWindowsAppsPath(pathEntry) {
  return pathEntry.replace(/\\/gu, "/").toLowerCase().includes("/windowsapps");
}

function getWindowsCodexBinaryMetadata() {
  if (process.arch === "arm64") {
    return {
      packageName: "codex-win32-arm64",
      targetTriple: "aarch64-pc-windows-msvc",
    };
  }

  return {
    packageName: "codex-win32-x64",
    targetTriple: "x86_64-pc-windows-msvc",
  };
}

function resolveWindowsCodexExecutable(pathEntry) {
  if (isWindowsAppsPath(pathEntry)) {
    return undefined;
  }

  const directExecutable = join(pathEntry, "codex.exe");
  if (existsSync(directExecutable)) {
    return directExecutable;
  }

  const metadata = getWindowsCodexBinaryMetadata();
  const vendorExecutable = join(
    pathEntry,
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    metadata.packageName,
    "vendor",
    metadata.targetTriple,
    "codex",
    "codex.exe",
  );

  return existsSync(vendorExecutable) ? vendorExecutable : undefined;
}

function findSystemCodexPath() {
  const pathValue = process.env.PATH ?? "";

  for (const entry of pathValue.split(delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed || isNodeModulesBinPath(trimmed)) {
      continue;
    }

    if (process.platform === "win32") {
      const windowsExecutable = resolveWindowsCodexExecutable(trimmed);
      if (windowsExecutable) {
        return windowsExecutable;
      }
      continue;
    }

    const fullPath =
      trimmed.endsWith("\\") || trimmed.endsWith("/")
        ? `${trimmed}codex`
        : `${trimmed}/codex`;

    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  return undefined;
}

function resolveDoctorCodexCommand(env) {
  if (env.SYNCAI_CODEX_PATH) {
    return {
      command: env.SYNCAI_CODEX_PATH,
      source: "SYNCAI_CODEX_PATH",
      resolvedPath: env.SYNCAI_CODEX_PATH,
    };
  }

  const systemCodexPath = findSystemCodexPath();
  if (systemCodexPath) {
    return {
      command: systemCodexPath,
      source: "system codex",
      resolvedPath: systemCodexPath,
    };
  }

  return {
    command: process.platform === "win32" ? "codex.cmd" : "codex",
    source: "PATH codex",
    resolvedPath: null,
  };
}

function runCommand(command, args, timeoutMs = 10000) {
  return new Promise((resolvePromise) => {
    const target = resolveSpawnTarget(command, args);
    const child = spawn(target.command, target.args, {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolvePromise({
          ok: false,
          stdout,
          stderr,
          error: `Timed out after ${timeoutMs}ms`,
        });
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          ok: false,
          stdout,
          stderr,
          error: error.message,
        });
      }
    });

    child.once("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          ok: code === 0,
          stdout,
          stderr,
          error: code === 0 ? "" : `Exited with code ${code ?? "null"}`,
        });
      }
    });
  });
}

function checkTcpConnection(host, port, timeoutMs = 3000) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok, detail) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolvePromise({ ok, detail });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, `${host}:${port}`));
    socket.once("timeout", () => finish(false, `Timed out connecting to ${host}:${port}`));
    socket.once("error", (error) => finish(false, error.message));
  });
}

function parseServiceUrl(rawUrl, fallbackPort) {
  const parsed = new URL(rawUrl);
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number(parsed.port) : fallbackPort,
  };
}

async function runChecks(options) {
  const env = {
    ...DEFAULTS,
    ...loadDotEnvFile(),
    ...process.env,
  };
  const checks = [];

  const majorVersion = Number(process.versions.node.split(".")[0] ?? "0");
  checks.push({
    name: "Node.js",
    ok: Number.isFinite(majorVersion) && majorVersion >= 24,
    detail: `current=${process.versions.node}, required>=24`,
  });

  const dockerVersion = await runCommand("docker", ["--version"]);
  checks.push({
    name: "Docker CLI",
    ok: dockerVersion.ok,
    detail: dockerVersion.ok
      ? dockerVersion.stdout.trim()
      : dockerVersion.error || dockerVersion.stderr.trim(),
  });

  const dockerInfo = await runCommand("docker", ["info", "--format", "{{.ServerVersion}}"]);
  checks.push({
    name: "Docker daemon",
    ok: dockerInfo.ok,
    detail: dockerInfo.ok
      ? `server=${dockerInfo.stdout.trim()}`
      : dockerInfo.error || dockerInfo.stderr.trim(),
  });

  try {
    const postgres = parseServiceUrl(env.SYNCAI_DATABASE_URL, 5432);
    const postgresProbe = await checkTcpConnection(postgres.host, postgres.port);
    checks.push({
      name: "PostgreSQL port",
      ok: postgresProbe.ok,
      detail: postgresProbe.ok
        ? `reachable ${postgres.host}:${postgres.port}`
        : postgresProbe.detail,
    });
  } catch (error) {
    checks.push({
      name: "PostgreSQL port",
      ok: false,
      detail: error instanceof Error ? error.message : "Invalid SYNCAI_DATABASE_URL",
    });
  }

  try {
    const redis = parseServiceUrl(env.SYNCAI_REDIS_URL, 6379);
    const redisProbe = await checkTcpConnection(redis.host, redis.port);
    checks.push({
      name: "Redis port",
      ok: redisProbe.ok,
      detail: redisProbe.ok
        ? `reachable ${redis.host}:${redis.port}`
        : redisProbe.detail,
    });
  } catch (error) {
    checks.push({
      name: "Redis port",
      ok: false,
      detail: error instanceof Error ? error.message : "Invalid SYNCAI_REDIS_URL",
    });
  }

  const codexCommand = resolveDoctorCodexCommand(env);
  const codexVersion = await runCommand(codexCommand.command, ["--version"]);
  checks.push({
    name: "Codex CLI",
    ok: codexVersion.ok,
    detail: codexVersion.ok
      ? `${codexCommand.source}${codexCommand.resolvedPath ? ` (${codexCommand.resolvedPath})` : ""}: ${codexVersion.stdout.trim()}`
      : `${codexCommand.source}${codexCommand.resolvedPath ? ` (${codexCommand.resolvedPath})` : ""}: ${codexVersion.error || codexVersion.stderr.trim()}`,
  });

  if (options.withCodexExec && codexVersion.ok) {
    const codexExec = await runCommand(
      codexCommand.command,
      ["exec", "--skip-git-repo-check", "Reply with exactly OK."],
      30000,
    );
    checks.push({
      name: "Codex exec",
      ok: codexExec.ok,
      detail: codexExec.ok
        ? "Codex can execute a real prompt in this environment"
        : codexExec.error || codexExec.stderr.trim() || codexExec.stdout.trim(),
    });
  } else if (!options.withCodexExec) {
    checks.push({
      name: "Codex exec",
      ok: true,
      detail: "Skipped. Re-run `npm run doctor -- --with-codex-exec` to verify real Codex auth/execution.",
    });
  }

  return checks;
}

function printHelp() {
  console.log(`SyncAI environment doctor

Usage:
  npm run doctor
  npm run doctor -- --with-codex-exec

Checks:
  - Node.js version
  - Docker CLI and daemon
  - PostgreSQL / Redis TCP reachability
  - Codex CLI presence
  - Optional real Codex execution probe
`);
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }

  const checks = await runChecks({
    withCodexExec: args.has("--with-codex-exec"),
  });

  console.log("SyncAI environment doctor");
  console.log("=========================");

  let hasFailure = false;

  for (const check of checks) {
    const marker = check.ok ? "[OK]" : "[FAIL]";
    console.log(`${marker} ${check.name}: ${check.detail}`);
    if (!check.ok) {
      hasFailure = true;
    }
  }

  if (hasFailure) {
    process.exitCode = 1;
    return;
  }

  console.log("All checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
