import { spawn } from "node:child_process";
import process from "node:process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function prefixStream(stream, label, writer) {
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.length > 0) {
        writer.write(`[${label}] ${line}\n`);
      }
    }
  });

  stream.on("end", () => {
    if (buffer.length > 0) {
      writer.write(`[${label}] ${buffer}\n`);
    }
  });
}

function runTask(label, args) {
  const child = spawn(npmCommand, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === "win32",
    stdio: ["inherit", "pipe", "pipe"],
  });

  prefixStream(child.stdout, label, process.stdout);
  prefixStream(child.stderr, label, process.stderr);

  return child;
}

function runOnce(label, args) {
  return new Promise((resolve, reject) => {
    const child = runTask(label, args);

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${label} exited with code ${code ?? "null"} and signal ${signal ?? "null"}`,
        ),
      );
    });

    child.on("error", reject);
  });
}

async function main() {
  console.log("==> building @syncai/shared once before dev");
  await runOnce("shared", ["run", "build", "--workspace", "@syncai/shared"]);

  console.log("==> starting server and web dev processes");
  const children = [
    runTask("server", ["run", "dev:server"]),
    runTask("web", ["run", "dev:web"]),
  ];

  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`==> received ${signal}, stopping dev processes`);

    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  children.forEach((child, index) => {
    child.on("exit", (code) => {
      if (!shuttingDown && code !== 0) {
        shutdown(`child-${index}-exit`);
        process.exitCode = code ?? 1;
      }
    });

    child.on("error", (error) => {
      console.error(error);
      shutdown(`child-${index}-error`);
      process.exitCode = 1;
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
