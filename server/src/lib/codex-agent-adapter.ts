import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { Codex } from "@openai/codex-sdk";
import type {
  MockAgentAdapter,
  MockAgentResult,
  StreamEvent,
  StartSessionInput,
  SendMessageInput,
} from "./mock-agent-adapter.js";

interface CodexSessionState {
  threadId: string;
  workingDirectory: string;
}

export class CodexWorkingDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexWorkingDirectoryError";
  }
}

function isNodeModulesBinPath(pathEntry: string) {
  const normalized = pathEntry.replace(/\\/gu, "/").toLowerCase();
  return normalized.includes("/node_modules/") && normalized.endsWith("/.bin");
}

function isWindowsAppsPath(pathEntry: string) {
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

function resolveWindowsCodexExecutable(pathEntry: string) {
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

export function resolveCodexExecutablePath(codexPath?: string) {
  if (codexPath) {
    return codexPath;
  }

  return findSystemCodexPath() ?? (process.platform === "win32" ? "codex.cmd" : "codex");
}

export function requireCodexWorkingDirectory(workingDirectory?: string) {
  if (!workingDirectory?.trim()) {
    throw new CodexWorkingDirectoryError(
      "Project working directory is not configured. Please set a valid working directory before starting a real Codex session.",
    );
  }

  const normalizedPath = workingDirectory.trim();

  let stats;
  try {
    stats = statSync(normalizedPath);
  } catch {
    throw new CodexWorkingDirectoryError(
      `Project working directory does not exist on this machine: ${normalizedPath}. Please update the project working directory and try again.`,
    );
  }

  if (!stats.isDirectory()) {
    throw new CodexWorkingDirectoryError(
      `Project working directory is not a directory: ${normalizedPath}. Please update the project working directory and try again.`,
    );
  }

  return normalizedPath;
}

export function createCodexAgentAdapter(options: {
  codexPath?: string;
} = {}): MockAgentAdapter {
  const codexPath = resolveCodexExecutablePath(options.codexPath);
  const codex = new Codex(
    codexPath ? { codexPathOverride: codexPath } : undefined,
  );

  const sessions = new Map<string, CodexSessionState>();

  return {
    async startSession(input: StartSessionInput) {
      const workingDirectory = requireCodexWorkingDirectory(
        input.workingDirectory,
      );

      sessions.set(input.sessionId, {
        threadId: "",
        workingDirectory,
      });

      return { agentSessionRef: input.sessionId };
    },

    async *sendMessage(
      input: SendMessageInput,
    ): AsyncGenerator<StreamEvent, MockAgentResult, void> {
      let sessionState = sessions.get(input.sessionId);
      if (!sessionState) {
        // Lazy init: session was created before server restart or binding was lost
        const wd = requireCodexWorkingDirectory(input.workingDirectory);
        sessionState = { threadId: "", workingDirectory: wd };
        sessions.set(input.sessionId, sessionState);
      }

      const thread = sessionState.threadId
        ? codex.resumeThread(sessionState.threadId, {
            workingDirectory: sessionState.workingDirectory,
            skipGitRepoCheck: true,
          })
        : codex.startThread({
            workingDirectory: sessionState.workingDirectory,
            skipGitRepoCheck: true,
          });

      let finalResponse = "";

      const streamedTurn = await thread.runStreamed(input.content);

      for await (const event of streamedTurn.events) {
        // Forward every SDK event to the stream
        yield {
          type: event.type,
          data: event as unknown as Record<string, unknown>,
        };

        // Capture the thread ID from the first thread.started event
        if (
          event.type === "thread.started" &&
          !sessionState.threadId &&
          "thread_id" in event
        ) {
          sessionState.threadId = String(event.thread_id);
        }

        // Accumulate the final agent response
        if (
          event.type === "item.completed" &&
          "item" in event &&
          event.item &&
          typeof event.item === "object" &&
          "type" in event.item &&
          event.item.type === "agent_message" &&
          "text" in event.item
        ) {
          finalResponse = String(event.item.text);
        }
      }

      const summary = finalResponse.slice(0, 160);

      return {
        summary,
        finalReply: finalResponse || "Codex completed with no output.",
      };
    },
  };
}
