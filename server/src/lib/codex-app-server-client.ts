import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { AgentRuntimeInfo, AgentUsageTrace } from "./agent-execution.js";
import { WebSocket } from "ws";

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcSuccessMessage {
  id: number | string;
  result: unknown;
}

interface JsonRpcErrorMessage {
  id: number | string | null;
  error: JsonRpcError;
}

interface JsonRpcNotificationMessage {
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcRequestMessage {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export type AppServerMessage =
  | JsonRpcSuccessMessage
  | JsonRpcErrorMessage
  | JsonRpcNotificationMessage
  | JsonRpcRequestMessage;

export interface AppServerApprovalRequest {
  requestId: string;
  kind: "command" | "file" | "permissions";
  threadId: string;
  turnId: string;
  itemId: string;
  command?: string | null;
  cwd?: string | null;
  reason?: string | null;
  changes?: Array<{
    path: string;
    kind: "add" | "delete" | "update";
  }>;
  permissions?: Record<string, unknown> | null;
}

export type AppServerApprovalDecision = "accept" | "decline";

export interface ThreadStartResult {
  threadId: string;
  runtime: AgentRuntimeInfo;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function delay(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve a websocket port for Codex app-server.")));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function mapApprovalPolicy(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && "granular" in value) {
    return "granular";
  }
  return null;
}

function mapSandboxMode(value: unknown) {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "dangerFullAccess":
      return "danger-full-access";
    case "workspaceWrite":
      return "workspace-write";
    case "readOnly":
      return "read-only";
    default:
      return value.type;
  }
}

function readNetworkAccess(value: unknown): boolean | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "dangerFullAccess":
      return true;
    case "workspaceWrite":
    case "readOnly":
      return typeof value.networkAccess === "boolean" ? value.networkAccess : null;
    case "externalSandbox": {
      const networkAccess = value.networkAccess;
      if (networkAccess === "enabled") {
        return true;
      }
      if (networkAccess === "disabled") {
        return false;
      }
      return null;
    }
    default:
      return null;
  }
}

function normalizeStatus(status: unknown) {
  if (typeof status !== "string") {
    return "unknown";
  }

  switch (status) {
    case "inProgress":
      return "in_progress";
    default:
      return status.toLowerCase();
  }
}

function normalizeFileKind(value: unknown): "add" | "delete" | "update" {
  if (typeof value === "string") {
    if (value === "add" || value === "delete" || value === "update") {
      return value;
    }
    return "update";
  }

  if (isRecord(value) && typeof value.type === "string") {
    if (value.type === "add" || value.type === "delete" || value.type === "update") {
      return value.type;
    }
  }

  return "update";
}

function normalizeCommandActions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => isRecord(entry));
}

function joinReasoningParts(item: Record<string, unknown>) {
  const summaryParts = Array.isArray(item.summary_parts)
    ? item.summary_parts.filter((part): part is string => typeof part === "string")
    : [];
  const contentParts = Array.isArray(item.content_parts)
    ? item.content_parts.filter((part): part is string => typeof part === "string")
    : [];

  return [...summaryParts, ...contentParts].join("\n").trim();
}

function updateIndexedTextParts(
  existing: Record<string, unknown> | undefined,
  key: "summary_parts" | "content_parts",
  index: number,
  delta: string,
) {
  const parts = Array.isArray(existing?.[key])
    ? [...existing[key] as string[]]
    : [];
  const currentValue = typeof parts[index] === "string" ? parts[index] : "";
  parts[index] = `${currentValue}${delta}`;
  return parts;
}

function mapThreadItem(item: unknown): Record<string, unknown> | null {
  if (!isRecord(item) || typeof item.type !== "string" || typeof item.id !== "string") {
    return null;
  }

  switch (item.type) {
    case "agentMessage":
      return {
        id: item.id,
        type: "agent_message",
        text: typeof item.text === "string" ? item.text : "",
        status: "completed",
      };
    case "commandExecution":
      return {
        id: item.id,
        type: "command_execution",
        command: typeof item.command === "string" ? item.command : "",
        cwd: typeof item.cwd === "string" ? item.cwd : null,
        status: normalizeStatus(item.status),
        aggregated_output:
          typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : null,
        exit_code: typeof item.exitCode === "number" ? item.exitCode : null,
        duration_ms: typeof item.durationMs === "number" ? item.durationMs : null,
        command_actions: normalizeCommandActions(item.commandActions),
      };
    case "fileChange":
      return {
        id: item.id,
        type: "file_change",
        status: normalizeStatus(item.status),
        changes: Array.isArray(item.changes)
          ? item.changes
              .filter((change) => isRecord(change) && typeof change.path === "string")
              .map((change) => ({
                path: change.path as string,
                kind: normalizeFileKind(change.kind),
                ...(typeof change.diff === "string" ? { diff: change.diff } : {}),
              }))
          : [],
      };
    case "reasoning": {
      const summary = Array.isArray(item.summary)
        ? item.summary.filter((part): part is string => typeof part === "string")
        : [];
      const content = Array.isArray(item.content)
        ? item.content.filter((part): part is string => typeof part === "string")
        : [];
      return {
        id: item.id,
        type: "reasoning",
        summary_parts: summary,
        content_parts: content,
        text: [...summary, ...content].join("\n").trim(),
        status: "completed",
      };
    }
    case "mcpToolCall":
      return {
        id: item.id,
        type: "mcp_tool_call",
        server: typeof item.server === "string" ? item.server : "",
        tool: typeof item.tool === "string" ? item.tool : "",
        status: normalizeStatus(item.status),
        result: item.result ?? null,
        error: item.error ?? null,
        duration_ms: typeof item.durationMs === "number" ? item.durationMs : null,
      };
    case "webSearch":
      return {
        id: item.id,
        type: "web_search",
        query: typeof item.query === "string" ? item.query : "",
        status: "completed",
      };
    default:
      return null;
  }
}

function createRuntimeInfo(
  response: Record<string, unknown>,
  thread: Record<string, unknown>,
): AgentRuntimeInfo {
  return {
    ...(typeof thread.id === "string" ? { thread_id: thread.id } : {}),
    model: typeof response.model === "string" ? response.model : null,
    model_provider:
      typeof response.modelProvider === "string" ? response.modelProvider : null,
    reasoning_effort:
      typeof response.reasoningEffort === "string" ? response.reasoningEffort : null,
    approval_policy: mapApprovalPolicy(response.approvalPolicy),
    sandbox_mode: mapSandboxMode(response.sandbox),
    network_access: readNetworkAccess(response.sandbox),
    branch: null,
    working_directory: typeof response.cwd === "string" ? response.cwd : null,
    cli_version: typeof thread.cliVersion === "string" ? thread.cliVersion : null,
    source: typeof thread.source === "string" ? thread.source : null,
  };
}

export function mapTokenUsage(value: unknown): AgentUsageTrace | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokens = typeof value.inputTokens === "number" ? value.inputTokens : null;
  const cachedInputTokens = typeof value.cachedInputTokens === "number" ? value.cachedInputTokens : null;
  const outputTokens = typeof value.outputTokens === "number" ? value.outputTokens : null;

  if (inputTokens === null || cachedInputTokens === null || outputTokens === null) {
    return undefined;
  }

  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    ...(typeof value.reasoningOutputTokens === "number"
      ? { reasoning_output_tokens: value.reasoningOutputTokens }
      : {}),
  };
}

export class CodexAppServerClient {
  private readonly codexPath: string;
  private child: ChildProcess | null = null;
  private socket: WebSocket | null = null;
  private port: number | null = null;
  private requestSequence = 0;
  private readonly pendingResponses = new Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();

  onNotification?: (message: JsonRpcNotificationMessage) => void;
  onServerRequest?: (message: JsonRpcRequestMessage) => Promise<Record<string, unknown>>;

  constructor(codexPath: string) {
    this.codexPath = codexPath;
  }

  async start() {
    this.port = await reservePort();
    this.child = spawn(this.codexPath, ["app-server", "--listen", `ws://127.0.0.1:${this.port}`], {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
      env: process.env,
    });

    this.child.on("exit", () => {
      const error = new Error("Codex app-server exited unexpectedly.");
      for (const pending of this.pendingResponses.values()) {
        pending.reject(error);
      }
      this.pendingResponses.clear();
    });

    const socket = await this.connectSocket(this.port);
    this.socket = socket;
    socket.on("message", (payload) => {
      void this.handleRawMessage(payload.toString());
    });
    socket.on("error", () => {
      // The pending request promises are rejected on close/exit; no extra action is required here.
    });
    socket.on("close", () => {
      const error = new Error("Codex app-server connection closed unexpectedly.");
      for (const pending of this.pendingResponses.values()) {
        pending.reject(error);
      }
      this.pendingResponses.clear();
    });

    await this.request("initialize", {
      clientInfo: {
        name: "syncai-server",
        title: "SyncAI Server",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
  }

  private async connectSocket(port: number) {
    const url = `ws://127.0.0.1:${port}`;
    const deadline = Date.now() + 15_000;
    let lastError: Error | null = null;

    while (Date.now() < deadline) {
      try {
        const socket = await new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(url);
          const cleanup = () => {
            ws.removeAllListeners("open");
            ws.removeAllListeners("error");
          };
          ws.once("open", () => {
            cleanup();
            resolve(ws);
          });
          ws.once("error", (error) => {
            cleanup();
            ws.terminate();
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        });
        return socket;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await delay(150);
      }
    }

    throw lastError ?? new Error("Failed to connect to Codex app-server.");
  }

  private async handleRawMessage(rawMessage: string) {
    const message = JSON.parse(rawMessage) as AppServerMessage;

    if (isRecord(message) && typeof (message as JsonRpcNotificationMessage).method === "string") {
      const notification = message as JsonRpcNotificationMessage;
      const requestId = (message as JsonRpcRequestMessage).id;
      if (requestId !== undefined && requestId !== null) {
        const request = message as JsonRpcRequestMessage;
        const result = this.onServerRequest
          ? await this.onServerRequest(request)
          : {};
        this.send({ id: request.id, result });
        return;
      }

      this.onNotification?.(notification);
      return;
    }

    const successMessage = message as JsonRpcSuccessMessage;
    if (successMessage.id !== undefined && !("error" in (message as unknown as Record<string, unknown>))) {
      const pending = this.pendingResponses.get(Number(successMessage.id));
      if (pending) {
        this.pendingResponses.delete(Number(successMessage.id));
        pending.resolve(isRecord(successMessage.result) ? successMessage.result : {});
      }
      return;
    }

    const errorMessage = message as JsonRpcErrorMessage;
    if (errorMessage.id !== undefined) {
      const pending = this.pendingResponses.get(Number(errorMessage.id));
      if (pending) {
        this.pendingResponses.delete(Number(errorMessage.id));
        pending.reject(new Error(errorMessage.error?.message ?? "Codex app-server request failed."));
      }
    }
  }

  private send(message: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server connection is not open.");
    }

    this.socket.send(JSON.stringify({ jsonrpc: "2.0", ...message }));
  }

  async request(method: string, params: Record<string, unknown>) {
    const id = this.requestSequence += 1;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pendingResponses.set(id, { resolve, reject });
    });
    this.send({ id, method, params });
    return promise;
  }

  async startThread(input: {
    threadId?: string;
    cwd: string;
    model?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
  }): Promise<ThreadStartResult> {
    const params: Record<string, unknown> = {
      cwd: input.cwd,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    };

    if (input.model) {
      params.model = input.model;
    }
    if (input.approvalPolicy) {
      params.approvalPolicy = input.approvalPolicy;
    }
    if (input.sandboxMode) {
      params.sandbox = input.sandboxMode;
    }

    const response = input.threadId
      ? await this.request("thread/resume", {
          threadId: input.threadId,
          cwd: input.cwd,
          persistExtendedHistory: false,
          ...(input.model ? { model: input.model } : {}),
          ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
          ...(input.sandboxMode ? { sandbox: input.sandboxMode } : {}),
        })
      : await this.request("thread/start", params);

    const thread = isRecord(response.thread) ? response.thread : null;
    if (!thread || typeof thread.id !== "string") {
      throw new Error("Codex app-server did not return a valid thread identifier.");
    }

    return {
      threadId: thread.id,
      runtime: createRuntimeInfo(response, thread),
    };
  }

  async startTurn(input: {
    threadId: string;
    text: string;
    model?: string;
    reasoningEffort?: string;
  }) {
    const response = await this.request("turn/start", {
      threadId: input.threadId,
      input: [
        {
          type: "text",
          text: input.text,
          text_elements: [],
        },
      ],
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}),
    });

    const turn = isRecord(response.turn) ? response.turn : null;
    if (!turn || typeof turn.id !== "string") {
      throw new Error("Codex app-server did not return a valid turn identifier.");
    }

    return {
      turnId: turn.id,
    };
  }

  async close() {
    try {
      this.socket?.close();
    } catch {
      // ignore websocket close failures during cleanup
    }
    this.socket = null;

    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
  }
}

export function buildApprovalRequest(message: JsonRpcRequestMessage, items: Map<string, Record<string, unknown>>) {
  const params = isRecord(message.params) ? message.params : {};
  const requestId = String(message.id);
  switch (message.method) {
    case "item/commandExecution/requestApproval":
      return {
        requestId,
        kind: "command",
        threadId: typeof params.threadId === "string" ? params.threadId : "",
        turnId: typeof params.turnId === "string" ? params.turnId : "",
        itemId: typeof params.itemId === "string" ? params.itemId : "",
        command: typeof params.command === "string" ? params.command : null,
        cwd: typeof params.cwd === "string" ? params.cwd : null,
        reason: typeof params.reason === "string" ? params.reason : null,
      } satisfies AppServerApprovalRequest;
    case "item/fileChange/requestApproval": {
      const itemId = typeof params.itemId === "string" ? params.itemId : "";
      const item = items.get(itemId);
      const changes = Array.isArray(item?.changes)
        ? item?.changes.filter((change): change is { path: string; kind: "add" | "delete" | "update" } => (
          isRecord(change)
          && typeof change.path === "string"
          && (change.kind === "add" || change.kind === "delete" || change.kind === "update")
        ))
        : [];
      return {
        requestId,
        kind: "file",
        threadId: typeof params.threadId === "string" ? params.threadId : "",
        turnId: typeof params.turnId === "string" ? params.turnId : "",
        itemId,
        reason: typeof params.reason === "string" ? params.reason : null,
        changes,
      } satisfies AppServerApprovalRequest;
    }
    case "item/permissions/requestApproval":
      return {
        requestId,
        kind: "permissions",
        threadId: typeof params.threadId === "string" ? params.threadId : "",
        turnId: typeof params.turnId === "string" ? params.turnId : "",
        itemId: typeof params.itemId === "string" ? params.itemId : "",
        cwd: typeof params.cwd === "string" ? params.cwd : null,
        reason: typeof params.reason === "string" ? params.reason : null,
        permissions: isRecord(params.permissions) ? params.permissions : null,
      } satisfies AppServerApprovalRequest;
    default:
      return null;
  }
}

export function buildApprovalResponse(
  request: AppServerApprovalRequest,
  decision: AppServerApprovalDecision,
) {
  if (request.kind === "permissions") {
    if (decision === "accept") {
      return {
        permissions: request.permissions ?? {},
        scope: "turn",
      };
    }
    return {
      permissions: {},
      scope: "turn",
    };
  }

  return {
    decision: decision === "accept" ? "accept" : "decline",
  };
}

export function mapNotificationToStreamEvent(
  notification: JsonRpcNotificationMessage,
  items: Map<string, Record<string, unknown>>,
  latestUsage: Map<string, AgentUsageTrace>,
) {
  const params = isRecord(notification.params) ? notification.params : {};

  switch (notification.method) {
    case "thread/started": {
      const thread = isRecord(params.thread) ? params.thread : null;
      if (!thread || typeof thread.id !== "string") {
        return null;
      }
      return {
        type: "thread.started",
        data: {
          thread_id: thread.id,
        },
      };
    }
    case "turn/started": {
      const turn = isRecord(params.turn) ? params.turn : null;
      if (!turn || typeof turn.id !== "string") {
        return null;
      }
      return {
        type: "turn.started",
        data: {
          turn_id: turn.id,
        },
      };
    }
    case "turn/completed": {
      const turn = isRecord(params.turn) ? params.turn : null;
      const turnId = typeof turn?.id === "string" ? turn.id : null;
      const usage = turnId ? latestUsage.get(turnId) : undefined;
      if (turn && turn.status === "failed") {
        return {
          type: "turn.failed",
          data: {
            error: {
              message:
                isRecord(turn.error) && typeof turn.error.message === "string"
                  ? turn.error.message
                  : "Turn failed.",
            },
          },
        };
      }
      return {
        type: "turn.completed",
        data: {
          ...(usage ? { usage } : {}),
        },
      };
    }
    case "item/started":
    case "item/completed": {
      const item = mapThreadItem(params.item);
      if (!item || typeof item.id !== "string") {
        return null;
      }
      const existing = items.get(item.id);
      if (
        item.type === "reasoning"
        && existing?.type === "reasoning"
      ) {
        const merged: Record<string, unknown> = {
          ...existing,
          ...item,
          summary_parts:
            Array.isArray(item.summary_parts) && item.summary_parts.length > 0
              ? item.summary_parts
              : existing.summary_parts,
          content_parts:
            Array.isArray(item.content_parts) && item.content_parts.length > 0
              ? item.content_parts
              : existing.content_parts,
        };
        merged.text = joinReasoningParts(merged) || String(existing.text ?? item.text ?? "");
        items.set(item.id, merged);
        return {
          type: notification.method === "item/started" ? "item.started" : "item.completed",
          data: { item: merged },
        };
      }
      items.set(item.id, item);
      return {
        type: notification.method === "item/started" ? "item.started" : "item.completed",
        data: { item },
      };
    }
    case "item/agentMessage/delta": {
      const itemId = typeof params.itemId === "string" ? params.itemId : "";
      const delta = typeof params.delta === "string" ? params.delta : "";
      const existing: Record<string, unknown> = items.get(itemId) ?? {
        id: itemId,
        type: "agent_message",
        text: "",
        status: "in_progress",
      };
      const next: Record<string, unknown> = {
        ...existing,
        id: itemId,
        type: "agent_message",
        status: "in_progress",
        text: `${typeof existing.text === "string" ? existing.text : ""}${delta}`,
      };
      items.set(itemId, next);
      return {
        type: "item.updated",
        data: { item: next },
      };
    }
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      const itemId = typeof params.itemId === "string" ? params.itemId : "";
      const delta = typeof params.delta === "string" ? params.delta : "";
      const existing: Record<string, unknown> = items.get(itemId) ?? {
        id: itemId,
        type: "reasoning",
        summary_parts: [],
        content_parts: [],
        text: "",
        status: "in_progress",
      };
      const next: Record<string, unknown> = {
        ...existing,
        id: itemId,
        type: "reasoning",
        status: "in_progress",
        summary_parts:
          notification.method === "item/reasoning/summaryTextDelta"
            ? updateIndexedTextParts(
                existing,
                "summary_parts",
                typeof params.summaryIndex === "number" ? params.summaryIndex : 0,
                delta,
              )
            : existing.summary_parts,
        content_parts:
          notification.method === "item/reasoning/textDelta"
            ? updateIndexedTextParts(
                existing,
                "content_parts",
                typeof params.contentIndex === "number" ? params.contentIndex : 0,
                delta,
              )
            : existing.content_parts,
      };
      next.text = joinReasoningParts(next);
      items.set(itemId, next);
      return {
        type: "item.updated",
        data: { item: next },
      };
    }
    case "item/commandExecution/outputDelta": {
      const itemId = typeof params.itemId === "string" ? params.itemId : "";
      const delta = typeof params.delta === "string" ? params.delta : "";
      const existing = items.get(itemId);
      if (!existing) {
        return null;
      }
      items.set(itemId, {
        ...existing,
        aggregated_output:
          `${typeof existing.aggregated_output === "string" ? existing.aggregated_output : ""}${delta}`,
      });
      return null;
    }
    case "thread/tokenUsage/updated": {
      const turnId = typeof params.turnId === "string" ? params.turnId : "";
      const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : null;
      const usage = mapTokenUsage(tokenUsage?.last);
      if (turnId && usage) {
        latestUsage.set(turnId, usage);
      }
      return null;
    }
    case "serverRequest/resolved": {
      return {
        type: "approval.resolved",
        data: {
          request_id: String(params.requestId ?? ""),
        },
      };
    }
    case "error": {
      return {
        type: "error",
        data: {
          message: typeof params.message === "string" ? params.message : "Codex app-server error",
        },
      };
    }
    default:
      return null;
  }
}
