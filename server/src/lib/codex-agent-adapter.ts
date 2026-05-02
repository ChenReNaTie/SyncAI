import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  buildApprovalRequest,
  buildApprovalResponse,
  CodexAppServerClient,
  mapNotificationToStreamEvent,
  type AppServerApprovalDecision,
} from "./codex-app-server-client.js";
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
  AgentMessageMetadataShape,
  AgentRuntimeInfo,
  AgentUsageTrace,
} from "./agent-execution.js";
import type {
  MockAgentAdapter,
  MockAgentResult,
  ResolveApprovalInput,
  SendMessageInput,
  StartSessionInput,
  StreamEvent,
} from "./mock-agent-adapter.js";

interface CodexSessionState {
  threadId: string;
  workingDirectory: string;
}

interface PendingApproval {
  resolve: (decision: AppServerApprovalDecision) => void;
}

class AsyncEventQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T) {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }

    this.items.push(item);
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ value: undefined as T, done: true });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.items.length > 0) {
      const value = this.items.shift();
      return { value: value as T, done: false };
    }

    if (this.closed) {
      return { value: undefined as T, done: true };
    }

    return await new Promise<IteratorResult<T>>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  [Symbol.asyncIterator]() {
    return this;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toCommandTrace(item: Record<string, unknown>): AgentCommandTrace {
  return {
    command: typeof item.command === "string" ? item.command : "",
    cwd: typeof item.cwd === "string" ? item.cwd : null,
    output: typeof item.aggregated_output === "string" ? item.aggregated_output : null,
    exit_code: typeof item.exit_code === "number" ? item.exit_code : null,
    status: typeof item.status === "string" ? item.status : "completed",
    duration_ms: typeof item.duration_ms === "number" ? item.duration_ms : null,
  };
}

function collectFileChanges(item: Record<string, unknown>, files: Map<string, AgentFileTrace>) {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  for (const change of changes) {
    if (!isRecord(change) || typeof change.path !== "string" || typeof change.kind !== "string") {
      continue;
    }
    files.set(change.path, {
      path: change.path,
      kind:
        change.kind === "add" || change.kind === "delete" || change.kind === "update"
          ? change.kind
          : "update",
    });
  }
}

function buildRuntimeHint(
  baseRuntime: AgentRuntimeInfo,
  workingDirectory: string,
  branch?: string | null,
) {
  return {
    ...baseRuntime,
    branch: branch ?? baseRuntime.branch ?? null,
    working_directory: workingDirectory,
  } satisfies AgentRuntimeInfo;
}

export function createCodexAgentAdapter(options: {
  codexPath?: string;
} = {}): MockAgentAdapter {
  const codexPath = resolveCodexExecutablePath(options.codexPath);
  const sessions = new Map<string, CodexSessionState>();
  const pendingApprovals = new Map<string, PendingApproval>();

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
      const supportedSandboxModes = new Set(listCodexSandboxModes());
      const supportedReasoningEfforts = new Set(listCodexReasoningEfforts(input.model));
      const supportedApprovalPolicies = new Set(listCodexApprovalPolicies());
      const turnStartedAt = new Date();
      const snapshot = captureWorkspaceSnapshot(sessionState.workingDirectory);
      const queue = new AsyncEventQueue<StreamEvent>();
      const items = new Map<string, Record<string, unknown>>();
      const commands = new Map<string, AgentCommandTrace>();
      const files = new Map<string, AgentFileTrace>();
      const latestUsage = new Map<string, AgentUsageTrace>();
      const client = new CodexAppServerClient(codexPath);
      let finalResponse = "";
      let usageTrace: AgentUsageTrace | undefined;
      let runtimeHint: AgentRuntimeInfo | null = null;
      let turnFailureMessage: string | null = null;
      const pendingApprovalKeys: string[] = [];

      try {
        client.onNotification = (notification) => {
          const streamEvent = mapNotificationToStreamEvent(notification, items, latestUsage);
          const params = isRecord(notification.params) ? notification.params : {};

          if (notification.method === "turn/completed") {
            const turn = isRecord(params.turn) ? params.turn : null;
            if (turn && typeof turn.id === "string") {
              usageTrace = latestUsage.get(turn.id) ?? usageTrace;
              if (turn.status === "failed") {
                const error = isRecord(turn.error) ? turn.error : null;
                turnFailureMessage =
                  typeof error?.message === "string"
                    ? error.message
                    : "Codex turn failed.";
              }
            }
          }

          if (streamEvent?.data && isRecord(streamEvent.data) && isRecord(streamEvent.data.item)) {
            const item = streamEvent.data.item as Record<string, unknown>;
            const itemType = typeof item.type === "string" ? item.type : "";
            if (itemType === "agent_message" && typeof item.text === "string") {
              finalResponse = item.text;
            }
            if (itemType === "command_execution") {
              commands.set(String(item.id ?? ""), toCommandTrace(item));
            }
            if (itemType === "file_change") {
              collectFileChanges(item, files);
            }
          }

          if (streamEvent) {
            queue.push(streamEvent);
          }

          if (notification.method === "turn/completed") {
            queue.close();
          }
        };

        client.onServerRequest = async (request) => {
          const approvalRequest = buildApprovalRequest(request, items);
          if (!approvalRequest) {
            return {};
          }

          const key = `${input.sessionId}:${approvalRequest.requestId}`;
          pendingApprovalKeys.push(key);
          queue.push({
            type: "approval.requested",
            data: {
              request_id: approvalRequest.requestId,
              kind: approvalRequest.kind,
              thread_id: approvalRequest.threadId,
              turn_id: approvalRequest.turnId,
              item_id: approvalRequest.itemId,
              ...(approvalRequest.command ? { command: approvalRequest.command } : {}),
              ...(approvalRequest.cwd ? { cwd: approvalRequest.cwd } : {}),
              ...(approvalRequest.reason ? { reason: approvalRequest.reason } : {}),
              ...(approvalRequest.changes ? { changes: approvalRequest.changes } : {}),
              ...(approvalRequest.permissions ? { permissions: approvalRequest.permissions } : {}),
            },
          });

          const decision = await new Promise<AppServerApprovalDecision>((resolve) => {
            pendingApprovals.set(key, { resolve });
          });
          pendingApprovals.delete(key);
          return buildApprovalResponse(approvalRequest, decision);
        };

        await client.start();
        const threadStart = await client.startThread({
          ...(sessionState.threadId ? { threadId: sessionState.threadId } : {}),
          cwd: sessionState.workingDirectory,
          ...(input.model ? { model: input.model } : {}),
          ...(input.approvalPolicy && supportedApprovalPolicies.has(input.approvalPolicy)
            ? { approvalPolicy: input.approvalPolicy }
            : {}),
          ...(input.sandboxMode && supportedSandboxModes.has(input.sandboxMode)
            ? { sandboxMode: input.sandboxMode }
            : {}),
        });
        sessionState.threadId = threadStart.threadId;
        runtimeHint = buildRuntimeHint(
          threadStart.runtime,
          sessionState.workingDirectory,
          snapshot.branch ?? null,
        );

        await client.startTurn({
          threadId: threadStart.threadId,
          text: input.content,
          ...(input.model ? { model: input.model } : {}),
          ...(input.modelReasoningEffort && supportedReasoningEfforts.has(input.modelReasoningEffort)
            ? { reasoningEffort: input.modelReasoningEffort }
            : {}),
        });

        for await (const event of queue) {
          yield event;
        }

        if (turnFailureMessage) {
          throw new Error(turnFailureMessage);
        }
      } finally {
        for (const key of pendingApprovalKeys) {
          pendingApprovals.delete(key);
        }
        queue.close();
        await client.close();
      }

      const summary = finalResponse.slice(0, 160);
      const turnCompletedAt = new Date();
      const metadata = buildAgentMessageMetadata({
        ...(sessionState.threadId ? { threadId: sessionState.threadId } : {}),
        workingDirectory: sessionState.workingDirectory,
        turnStartedAt,
        turnCompletedAt,
        snapshot,
        fallbackCommands: [...commands.values()],
        fallbackFiles: [...files.values()],
        ...(usageTrace ? { usage: usageTrace } : {}),
      });

      if (runtimeHint) {
        metadata.codex_runtime = {
          ...(metadata.codex_runtime ?? {}),
          ...runtimeHint,
        } satisfies AgentMessageMetadataShape["codex_runtime"];
      }

      return {
        summary,
        finalReply: finalResponse || "Codex completed with no output.",
        metadata,
      };
    },

    async resolveApproval(input: ResolveApprovalInput) {
      const key = `${input.sessionId}:${input.requestId}`;
      const pending = pendingApprovals.get(key);
      if (!pending) {
        return false;
      }

      pendingApprovals.delete(key);
      pending.resolve(input.decision);
      return true;
    },
  };
}
