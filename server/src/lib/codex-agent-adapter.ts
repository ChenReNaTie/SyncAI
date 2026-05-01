import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { Codex } from "@openai/codex-sdk";
import type {
  CommandExecutionItem,
  FileChangeItem,
  ThreadOptions,
  Usage,
} from "@openai/codex-sdk";
import {
  buildAgentMessageMetadata,
  captureWorkspaceSnapshot,
  listCodexApprovalPolicies,
  listCodexReasoningEfforts,
  listCodexSandboxModes,
} from "./codex-observability.js";
import type {
  AgentCommandTrace,
  AgentFileTrace,
  AgentUsageTrace,
} from "./agent-execution.js";
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

export class CodexBranchSwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexBranchSwitchError";
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

export function resolvePersistedCodexThreadId(
  sessionId: string,
  agentSessionRef?: string,
) {
  const normalizedRef = agentSessionRef?.trim();
  if (!normalizedRef) {
    return undefined;
  }

  if (
    normalizedRef === sessionId ||
    normalizedRef === `syncai-session:${sessionId}`
  ) {
    return undefined;
  }

  return normalizedRef;
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

function runGit(workingDirectory: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: workingDirectory,
    encoding: "utf8",
    windowsHide: true,
  });
}

function ensureGitBranch(workingDirectory: string, branch?: string) {
  const normalizedBranch = branch?.trim();
  if (!normalizedBranch) {
    return;
  }

  const currentBranch = runGit(workingDirectory, ["branch", "--show-current"]);
  if (currentBranch.status === 0 && String(currentBranch.stdout ?? "").trim() === normalizedBranch) {
    return;
  }

  const knownBranch = runGit(workingDirectory, ["rev-parse", "--verify", normalizedBranch]);
  if (knownBranch.status !== 0) {
    throw new CodexBranchSwitchError(
      `Configured branch does not exist in this workspace: ${normalizedBranch}.`,
    );
  }

  const switched = runGit(workingDirectory, ["switch", normalizedBranch]);
  if (switched.status !== 0) {
    const stderr = String(switched.stderr ?? "").trim();
    throw new CodexBranchSwitchError(
      stderr.length > 0
        ? `Failed to switch workspace branch to ${normalizedBranch}: ${stderr}`
        : `Failed to switch workspace branch to ${normalizedBranch}.`,
    );
  }
}

function buildThreadOptions(input: SendMessageInput, workingDirectory: string): ThreadOptions {
  const supportedSandboxModes = new Set(listCodexSandboxModes());
  const supportedReasoningEfforts = new Set(listCodexReasoningEfforts(input.model));
  const supportedApprovalPolicies = new Set(listCodexApprovalPolicies());
  const options: ThreadOptions = {
    workingDirectory,
    skipGitRepoCheck: true,
  };

  if (input.model) {
    options.model = input.model;
  }
  if (input.sandboxMode && supportedSandboxModes.has(input.sandboxMode)) {
    options.sandboxMode =
      input.sandboxMode as NonNullable<ThreadOptions["sandboxMode"]>;
  }
  if (
    input.modelReasoningEffort
    && supportedReasoningEfforts.has(input.modelReasoningEffort)
  ) {
    options.modelReasoningEffort =
      input.modelReasoningEffort as NonNullable<ThreadOptions["modelReasoningEffort"]>;
  }
  if (input.approvalPolicy && supportedApprovalPolicies.has(input.approvalPolicy)) {
    options.approvalPolicy =
      input.approvalPolicy as NonNullable<ThreadOptions["approvalPolicy"]>;
  }

  return options;
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
        sessionState = {
          threadId:
            resolvePersistedCodexThreadId(
              input.sessionId,
              input.agentSessionRef,
            ) ?? "",
          workingDirectory: wd,
        };
        sessions.set(input.sessionId, sessionState);
      } else if (!sessionState.threadId) {
        sessionState.threadId =
          resolvePersistedCodexThreadId(
            input.sessionId,
            input.agentSessionRef,
          ) ?? sessionState.threadId;
      }

      ensureGitBranch(sessionState.workingDirectory, input.branch);
      const threadOptions = buildThreadOptions(input, sessionState.workingDirectory);

      const thread = sessionState.threadId
        ? codex.resumeThread(sessionState.threadId, threadOptions)
        : codex.startThread(threadOptions);

      let finalResponse = "";
      let usageTrace: AgentUsageTrace | undefined;
      const commands = new Map<string, AgentCommandTrace>();
      const files = new Map<string, AgentFileTrace>();
      const turnStartedAt = new Date();
      const snapshot = captureWorkspaceSnapshot(sessionState.workingDirectory);

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

        if (
          "item" in event &&
          event.item &&
          typeof event.item === "object" &&
          "type" in event.item &&
          event.item.type === "command_execution"
        ) {
          const item = event.item as CommandExecutionItem;
          commands.set(item.id, {
            command: item.command,
            cwd: sessionState.workingDirectory,
            output: item.aggregated_output,
            exit_code: item.exit_code ?? null,
            status: item.status,
          });
        }

        if (
          "item" in event &&
          event.item &&
          typeof event.item === "object" &&
          "type" in event.item &&
          event.item.type === "file_change"
        ) {
          const item = event.item as FileChangeItem;
          for (const change of item.changes) {
            files.set(change.path, {
              path: change.path,
              kind: change.kind,
            });
          }
        }

        if (event.type === "turn.completed") {
          const usage = event.usage as Usage;
          usageTrace = {
            input_tokens: usage.input_tokens,
            cached_input_tokens: usage.cached_input_tokens,
            output_tokens: usage.output_tokens,
            reasoning_output_tokens: usage.reasoning_output_tokens,
          };
        }
      }

      const summary = finalResponse.slice(0, 160);
      const turnCompletedAt = new Date();

      return {
        summary,
        finalReply: finalResponse || "Codex completed with no output.",
        metadata: buildAgentMessageMetadata({
          workingDirectory: sessionState.workingDirectory,
          turnStartedAt,
          turnCompletedAt,
          snapshot,
          fallbackCommands: [...commands.values()],
          fallbackFiles: [...files.values()],
          ...(sessionState.threadId ? { threadId: sessionState.threadId } : {}),
          ...(usageTrace ? { usage: usageTrace } : {}),
        }),
      };
    },
  };
}
