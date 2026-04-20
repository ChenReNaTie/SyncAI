import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCommand, waitForUrl } from "./process.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function quoteWindowsArg(arg) {
  const text = String(arg);
  if (!/[\s"]/u.test(text)) {
    return text;
  }

  const escaped = text.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function quoteWindowsCommand(command) {
  return /[\\/\s:]/.test(command) ? quoteWindowsArg(command) : command;
}

function resolveSpawnTarget(command, args) {
  if (process.platform === "win32" && /\.cmd$/i.test(command)) {
    return {
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        [quoteWindowsCommand(command), ...args.map(quoteWindowsArg)].join(" "),
      ],
    };
  }

  return { command, args };
}

function createLogBuffer() {
  let buffer = "";

  return {
    push(chunk) {
      buffer += chunk.toString();
      if (buffer.length > 12000) {
        buffer = buffer.slice(-12000);
      }
    },
    read() {
      return buffer.trim();
    },
  };
}

async function killTree(child) {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    try {
      await runCommand("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        acceptExitCodes: [0, 128, 255],
      });
    } catch {
      child.kill("SIGTERM");
    }
    return;
  }

  child.kill("SIGTERM");
}

export async function startDevStack() {
  const logs = createLogBuffer();
  const target = resolveSpawnTarget(npmCommand, ["run", "dev"]);
  const child = spawn(target.command, target.args, {
    cwd: repoRoot,
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    logs.push(chunk);
  });

  child.stderr.on("data", (chunk) => {
    logs.push(chunk);
  });

  const stop = async () => {
    await killTree(child);
  };

  return {
    child,
    logs,
    stop,
  };
}

export async function waitForDevServices(options = {}) {
  const {
    frontendUrl = "http://127.0.0.1:5173",
    backendUrl = "http://127.0.0.1:3001/api/v1/health",
    timeoutMs = 45000,
  } = options;

  const frontendResponse = await waitForUrl(frontendUrl, { timeoutMs });
  const backendResponse = await waitForUrl(backendUrl, { timeoutMs });

  return {
    frontendResponse,
    backendResponse,
  };
}
