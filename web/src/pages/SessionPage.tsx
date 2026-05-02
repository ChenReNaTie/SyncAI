import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  clearAuthSession,
  createTodo,
  getMessages,
  getReplay,
  getSessionAgentConfig,
  getSessionAgentContext,
  getSessionDetail,
  getStoredAuthToken,
  getTodos,
  hasStoredAuthSession,
  sendMessage,
  updateSessionAgentConfig,
  updateTodoStatus,
} from "../api/client.js";
import type {
  AgentCommandTrace,
  AgentConfigState,
  AgentFileDiffTrace,
  AgentFileTrace,
  AgentMessageMetadata,
  AgentRuntimeInfo,
  AgentSessionConfig,
  AgentUsageTrace,
  Message,
  ReplayEntry,
  SessionDetail,
  Todo,
  TodoStatus,
} from "../api/client.js";
import { createSessionSocket } from "../api/socket.js";
import { Badge, GlassCard, PageLoading, PageShell } from "../components/index.js";

interface CodexStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

type ItemType =
  | "command_execution"
  | "agent_message"
  | "reasoning"
  | "file_change"
  | "mcp_tool_call"
  | "web_search"
  | "todo_list"
  | "error";

type StreamTone = "neutral" | "accent" | "success" | "danger" | "warning";

interface RenderedEvent {
  id: string;
  icon: string;
  text: string;
  tone: StreamTone;
  spinning: boolean;
}

interface MessagePresenter {
  id: string;
  label: string;
  avatarText: string;
  tone: "human" | "agent";
}

type MessageWithAuthor = Message & {
  sender_display_name?: string;
  sender_user_id?: string;
  sender_role?: string;
  author_name?: string;
  author_id?: string;
};

interface BackTarget {
  label: string;
  href: string;
  state?: {
    backTo?: BackTarget;
  };
}

interface PageLocationState {
  backTo?: BackTarget;
}

interface PendingApprovalRequest {
  request_id: string;
  kind: "command" | "file" | "permissions";
  thread_id?: string;
  turn_id?: string;
  item_id?: string;
  command?: string;
  cwd?: string;
  reason?: string;
  changes?: AgentFileTrace[];
  permissions?: Record<string, unknown>;
}

let eventSequence = 0;

function resolveDisplayedCodexThreadId(session: SessionDetail | null) {
  const ref = session?.bound_agent_session_ref?.trim();
  if (!session || !ref) {
    return null;
  }

  if (ref === session.id || ref === `syncai-session:${session.id}`) {
    return null;
  }

  return ref;
}

function isAgentSender(sender: string) {
  return sender === "agent" || sender === "ai";
}

function formatRuntimeStatus(status: string) {
  switch (status) {
    case "queued":
      return "排队中";
    case "pending":
      return "等待中";
    case "running":
    case "in_progress":
      return "处理中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "idle":
      return "空闲";
    case "online":
      return "在线";
    case "offline":
      return "离线";
    default:
      return status;
  }
}

function formatClock(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInitials(label: string) {
  const letters = Array.from(label.trim()).filter((char) => char !== " ");
  if (letters.length === 0) {
    return "成员";
  }

  return letters.slice(0, 2).join("").toUpperCase();
}

function getMessagePresenter(message: Message): MessagePresenter {
  const enriched = message as MessageWithAuthor;
  const agent = isAgentSender(message.sender);
  const label = enriched.sender_display_name
    ?? enriched.author_name
    ?? (agent ? "协作助手" : message.sender === "user" ? "团队成员" : message.sender);


  return {
    id: enriched.sender_user_id ?? enriched.author_id ?? label,
    label,
    avatarText: agent ? "助手" : getInitials(label),
    tone: agent ? "agent" : "human",
  };
}

function mapReplayEntryToMessage(entry: ReplayEntry, index: number): Message {
  if (entry.entry_type === "message") {
    return {
      id: entry.message_id,
      content: entry.content,
      sender: entry.sender_type === "agent" ? "agent" : "user",
      sender_type: entry.sender_type,
      sender_display_name: entry.sender_type === "agent" ? "历史助手" : "历史成员",
      session_id: `replay-${index}`,
      created_at: entry.occurred_at,
    };
  }

  return {
    id: `replay-${entry.entry_type}-${index}`,
    content: entry.summary,
    sender: "agent",
    sender_type: "agent",
    sender_display_name: "系统记录",
    session_id: `replay-${index}`,
    created_at: entry.occurred_at,
  };
}

function renderStreamEvent(event: CodexStreamEvent): RenderedEvent | null {
  const data = event.data ?? {};
  const item = data.item as Record<string, unknown> | undefined;

  switch (event.type) {
    case "thread.started":
      return {
        id: `thread-${++eventSequence}`,
        icon: "线",
        text: `已创建线程：${String(data.thread_id ?? "-")}`,
        tone: "neutral",
        spinning: false,
      };

    case "turn.started":
      return {
        id: `turn-started-${++eventSequence}`,
        icon: "流",
        text: "开始处理这一轮消息",
        tone: "accent",
        spinning: true,
      };

    case "turn.completed": {
      const usage = data.usage as Record<string, number> | undefined;
      const input = usage?.input_tokens ?? 0;
      const cached = usage?.cached_input_tokens ?? 0;
      const output = usage?.output_tokens ?? 0;
      return {
        id: `turn-completed-${++eventSequence}`,
        icon: "算",
        text: `处理完成：输入 ${input} / 缓存 ${cached} / 输出 ${output}`,
        tone: "success",
        spinning: false,
      };
    }

    case "turn.failed": {
      const errorMessage =
        data.error && typeof data.error === "object"
          ? (data.error as Record<string, unknown>).message
          : "未知错误";
      return {
        id: `turn-failed-${++eventSequence}`,
        icon: "错",
        text: `处理失败：${String(errorMessage)}`,
        tone: "danger",
        spinning: false,
      };
    }

    case "error":
      return {
        id: `stream-error-${++eventSequence}`,
        icon: "告",
        text: `流事件异常：${String(data.message ?? "未知错误")}`,
        tone: "danger",
        spinning: false,
      };

    case "item.started":
      return renderItemRow("started", item);
    case "item.updated":
      return renderItemRow("updated", item);
    case "item.completed":
      return renderItemRow("completed", item);

    default:
      return null;
  }
}

function renderItemRow(
  phase: "started" | "updated" | "completed",
  item: Record<string, unknown> | undefined,
): RenderedEvent | null {
  if (!item) {
    return null;
  }

  const id = String(item.id ?? ++eventSequence);
  const itemType = String(item.type ?? "") as ItemType;
  const status = String(item.status ?? "");
  const spinning = status === "in_progress";
  const rowId = `${itemType}-${id}-${phase}`;

  switch (itemType) {
    case "command_execution": {
      const command = String(item.command ?? "").slice(0, 100);
      const exitCode = item.exit_code != null ? Number(item.exit_code) : undefined;
      const ok = exitCode === 0;

      if (status === "completed" && ok) {
        return { id: rowId, icon: "命", text: command, tone: "success", spinning: false };
      }
      if (status === "completed" || status === "failed") {
        return { id: rowId, icon: "命", text: command, tone: "danger", spinning: false };
      }

      return { id: rowId, icon: "命", text: command, tone: "accent", spinning: true };
    }

    case "agent_message": {
      const text = String(item.text ?? "");
      if (phase === "started") {
        return {
          id: rowId,
          icon: "答",
          text: "正在生成回复内容",
          tone: "accent",
          spinning: true,
        };
      }
      return { id: rowId, icon: "答", text, tone: "neutral", spinning: false };
    }

    case "reasoning": {
      const text = String(item.text ?? "").trim();
      if (!text) {
        return {
          id: rowId,
          icon: "˼",
          text: phase === "completed" ? "思考完成" : "正在思考...",
          tone: "neutral",
          spinning: phase !== "completed",
        };
      }
      return {
        id: rowId,
        icon: "˼",
        text: text.slice(0, 220),
        tone: "neutral",
        spinning,
      };
    }

    case "file_change": {
      const changes = item.changes as Array<{ path: string; kind: string }> | undefined;
      const summary = changes?.map((change) => {
        const prefix = change.kind === "add" ? "+" : change.kind === "delete" ? "-" : "~";
        return `${prefix} ${change.path}`;
      }).join(" / ") ?? "文件变更";
      return {
        id: rowId,
        icon: "改",
        text: summary,
        tone: status === "failed" ? "danger" : "neutral",
        spinning: status === "in_progress",
      };
    }

    case "mcp_tool_call": {
      const server = String(item.server ?? "");
      const tool = String(item.tool ?? "");
      const suffix = item.error ? `：${String(item.error)}` : item.result ? "：已返回结果" : "";
      return {
        id: rowId,
        icon: "具",
        text: `${server}:${tool}${suffix}`.slice(0, 140),
        tone: item.error ? "danger" : "accent",
        spinning: status === "in_progress",
      };
    }

    case "web_search":
      return {
        id: rowId,
        icon: "搜",
        text: String(item.query ?? "").slice(0, 120),
        tone: "warning",
        spinning: false,
      };

    case "todo_list": {
      const todos = item.items as Array<{ text: string; completed: boolean }> | undefined;
      const list = todos?.map((todo) => `${todo.completed ? "[x]" : "[ ]"} ${todo.text}`).join(" / ") ?? "待办同步";
      return {
        id: rowId,
        icon: "办",
        text: list.slice(0, 160),
        tone: "warning",
        spinning: false,
      };
    }

    case "error":
      return {
        id: rowId,
        icon: "错",
        text: String(item.message ?? "未知步骤错误").slice(0, 140),
        tone: "danger",
        spinning: false,
      };

    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeCommandTrace(value: unknown): AgentCommandTrace | null {
  if (!isRecord(value) || typeof value.command !== "string" || typeof value.status !== "string") {
    return null;
  }

  return {
    command: value.command,
    status: value.status,
    cwd: typeof value.cwd === "string" ? value.cwd : null,
    output: typeof value.output === "string" ? value.output : null,
    exit_code: typeof value.exit_code === "number" ? value.exit_code : null,
    duration_ms: typeof value.duration_ms === "number" ? value.duration_ms : null,
  };
}

function sanitizeFileTrace(value: unknown): AgentFileTrace | null {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.kind !== "string") {
    return null;
  }

  if (!["add", "delete", "update"].includes(value.kind)) {
    return null;
  }

  return {
    path: value.path,
    kind: value.kind as AgentFileTrace["kind"],
  };
}

function sanitizeFileDiffTrace(value: unknown): AgentFileDiffTrace | null {
  const file = sanitizeFileTrace(value);
  if (!file || !isRecord(value) || typeof value.patch !== "string") {
    return null;
  }

  return {
    ...file,
    patch: value.patch,
  };
}

function sanitizeUsageTrace(value: unknown): AgentUsageTrace | null {
  if (
    !isRecord(value)
    || typeof value.input_tokens !== "number"
    || typeof value.cached_input_tokens !== "number"
    || typeof value.output_tokens !== "number"
  ) {
    return null;
  }

  return {
    input_tokens: value.input_tokens,
    cached_input_tokens: value.cached_input_tokens,
    output_tokens: value.output_tokens,
    ...(typeof value.reasoning_output_tokens === "number"
      ? { reasoning_output_tokens: value.reasoning_output_tokens }
      : {}),
  };
}

function sanitizeRuntimeInfo(value: unknown): AgentRuntimeInfo | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    ...(typeof value.thread_id === "string" ? { thread_id: value.thread_id } : {}),
    model: typeof value.model === "string" ? value.model : null,
    model_provider: typeof value.model_provider === "string" ? value.model_provider : null,
    reasoning_effort:
      typeof value.reasoning_effort === "string" ? value.reasoning_effort : null,
    approval_policy:
      typeof value.approval_policy === "string" ? value.approval_policy : null,
    sandbox_mode: typeof value.sandbox_mode === "string" ? value.sandbox_mode : null,
    network_access:
      typeof value.network_access === "boolean" ? value.network_access : null,
    branch: typeof value.branch === "string" ? value.branch : null,
    working_directory:
      typeof value.working_directory === "string" ? value.working_directory : null,
    cli_version: typeof value.cli_version === "string" ? value.cli_version : null,
    source: typeof value.source === "string" ? value.source : null,
  };
}

function parseAgentMetadata(metadata: Record<string, unknown> | undefined): AgentMessageMetadata | null {
  if (!metadata || !isRecord(metadata)) {
    return null;
  }

  const runtime = sanitizeRuntimeInfo(metadata.codex_runtime);
  const executionTrace = isRecord(metadata.execution_trace)
    ? {
        commands: Array.isArray(metadata.execution_trace.commands)
          ? metadata.execution_trace.commands
              .map((command) => sanitizeCommandTrace(command))
              .filter((command): command is AgentCommandTrace => command !== null)
          : [],
        files: Array.isArray(metadata.execution_trace.files)
          ? metadata.execution_trace.files
              .map((file) => sanitizeFileTrace(file))
              .filter((file): file is AgentFileTrace => file !== null)
          : [],
        file_diffs: Array.isArray(metadata.execution_trace.file_diffs)
          ? metadata.execution_trace.file_diffs
              .map((diff) => sanitizeFileDiffTrace(diff))
              .filter((diff): diff is AgentFileDiffTrace => diff !== null)
          : [],
      }
    : undefined;
  const usage = sanitizeUsageTrace(metadata.usage);

  if (!runtime && !executionTrace && !usage) {
    return null;
  }

  return {
    ...(runtime ? { codex_runtime: runtime } : {}),
    ...(executionTrace ? { execution_trace: executionTrace } : {}),
    ...(usage ? { usage } : {}),
  };
}

function getLatestAgentRuntime(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (!isAgentSender(message.sender)) {
      continue;
    }

    const metadata = parseAgentMetadata(message.metadata);
    if (metadata?.codex_runtime) {
      return metadata.codex_runtime;
    }
  }

  return null;
}

function formatReasoningEffort(value?: string | null) {
  switch (value) {
    case "minimal":
      return "Minimal";
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "XHigh";
    default:
      return value ?? "等待首轮执行";
  }
}

function formatSandboxMode(value?: string | null) {
  switch (value) {
    case "danger-full-access":
      return "完全访问";
    case "workspace-write":
      return "工作区可写";
    case "read-only":
      return "只读";
    case "unelevated":
      return "默认权限";
    default:
      return value ?? "等待首轮执行";
  }
}

function formatApprovalPolicy(value?: string | null) {
  switch (value) {
    case "never":
      return "从不审批";
    case "on-request":
      return "按需审批";
    case "on-failure":
      return "失败后审批";
    case "untrusted":
      return "仅不可信命令审批";
    default:
      return value ?? "-";
  }
}

function formatNetworkAccess(value?: boolean | null) {
  if (value === true) {
    return "已启用";
  }
  if (value === false) {
    return "已限制";
  }
  return "未知";
}

function formatCommandStatus(status: string) {
  switch (status) {
    case "completed":
      return "已完成";
    case "declined":
      return "已拒绝";
    case "approved":
      return "已批准";
    case "failed":
      return "失败";
    case "in_progress":
      return "执行中";
    default:
      return status;
  }
}

function formatDuration(durationMs?: number | null) {
  if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
    return null;
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)} s`;
}

function formatUsageSummary(usage?: AgentUsageTrace | null) {
  if (!usage) {
    return null;
  }

  const summary = [
    `输入 ${usage.input_tokens}`,
    `缓存 ${usage.cached_input_tokens}`,
    `输出 ${usage.output_tokens}`,
  ];

  if (typeof usage.reasoning_output_tokens === "number") {
    summary.push(`推理 ${usage.reasoning_output_tokens}`);
  }

  return `Token 用量：${summary.join(" / ")}`;
}

function formatFileKind(kind: AgentFileTrace["kind"]) {
  switch (kind) {
    case "add":
      return "新增";
    case "delete":
      return "删除";
    case "update":
      return "修改";
    default:
      return kind;
  }
}

function formatApprovalKind(kind: PendingApprovalRequest["kind"]) {
  switch (kind) {
    case "command":
      return "命令执行审批";
    case "file":
      return "文件改动审批";
    case "permissions":
      return "权限提升审批";
    default:
      return kind;
  }
}

function getDiffLineClass(line: string) {
  if (line.startsWith("@@")) {
    return "session-diff-line session-diff-line--hunk";
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "session-diff-line session-diff-line--add";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "session-diff-line session-diff-line--remove";
  }
  if (
    line.startsWith("diff --git")
    || line.startsWith("index ")
    || line.startsWith("--- ")
    || line.startsWith("+++ ")
    || line.startsWith("new file mode")
    || line.startsWith("deleted file mode")
  ) {
    return "session-diff-line session-diff-line--meta";
  }
  return "session-diff-line";
}

function hasExecutionDetails(metadata: AgentMessageMetadata | null) {
  if (!metadata) {
    return false;
  }

  const commandCount = metadata.execution_trace?.commands.length ?? 0;
  const fileCount = metadata.execution_trace?.files.length ?? 0;
  const diffCount = metadata.execution_trace?.file_diffs.length ?? 0;
  return Boolean(commandCount || fileCount || diffCount);
}

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<ReturnType<typeof createSessionSocket> | null>(null);
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const highlightTimerRef = useRef<number | null>(null);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [agentContext, setAgentContext] = useState<AgentRuntimeInfo | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfigState | null>(null);
  const [agentConfigSaving, setAgentConfigSaving] = useState<string | null>(null);
  const [agentConfigError, setAgentConfigError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [replayMode, setReplayMode] = useState(false);
  const [replayMessages, setReplayMessages] = useState<Message[]>([]);
  const [replayLoading, setReplayLoading] = useState(false);

  const [todos, setTodos] = useState<Todo[]>([]);
  const [todosLoading, setTodosLoading] = useState(false);
  const [newTodoMessageId, setNewTodoMessageId] = useState<string | null>(null);
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [todoCreating, setTodoCreating] = useState(false);
  const [todoError, setTodoError] = useState<string | null>(null);
  const [todoPanelCollapsed, setTodoPanelCollapsed] = useState(false);

  const [streamEvents, setStreamEvents] = useState<CodexStreamEvent[]>([]);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalRequest | null>(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState<"accept" | "decline" | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const token = getStoredAuthToken();
  const locationState = location.state as PageLocationState | null;
  const displayMessages = replayMode ? replayMessages : messages;
  const projectLink = session?.project_id ? `/projects/${session.project_id}` : "/dashboard";
  const sessionBackTo = locationState?.backTo ?? {
    label: "返回会话列表",
    href: projectLink,
  };
  const codexThreadId = resolveDisplayedCodexThreadId(session);
  const renderedEvents = streamEvents
    .map(renderStreamEvent)
    .filter((event): event is RenderedEvent => event !== null);
  const pendingTodos = todos.filter((todo) => todo.status === "pending");
  const doneTodos = todos.filter((todo) => todo.status === "completed");
  const sortedTodos = [...pendingTodos, ...doneTodos];
  const hasBusyStream = sending || renderedEvents.some((event) => event.spinning);
  const visibleEvents = renderedEvents.slice(-10);
  const hiddenEventCount = Math.max(renderedEvents.length - visibleEvents.length, 0);
  const showLiveStream = !replayMode && (sending || renderedEvents.length > 0);
  const latestAgentRuntime = getLatestAgentRuntime(messages);
  const displayAgentRuntime =
    agentConfig?.runtime
    ?? agentContext
    ?? latestAgentRuntime
    ?? (codexThreadId ? { thread_id: codexThreadId } : null);
  const selectedModel =
    agentConfig?.selected.model
    ?? displayAgentRuntime?.model
    ?? "";
  const selectedReasoningEffort =
    agentConfig?.selected.reasoning_effort
    ?? displayAgentRuntime?.reasoning_effort
    ?? "";
  const selectedApprovalPolicy =
    agentConfig?.selected.approval_policy
    ?? displayAgentRuntime?.approval_policy
    ?? "";
  const selectedSandboxMode =
    agentConfig?.selected.sandbox_mode
    ?? displayAgentRuntime?.sandbox_mode
    ?? "";
  const selectedBranch =
    agentConfig?.selected.branch
    ?? displayAgentRuntime?.branch
    ?? "";
  const modelOptions = agentConfig?.options.models ?? (selectedModel ? [selectedModel] : []);
  const reasoningOptions = agentConfig?.options.reasoning_efforts ?? [];
  const approvalOptions =
    agentConfig?.options.approval_policies
    ?? (selectedApprovalPolicy ? [selectedApprovalPolicy] : []);
  const sandboxOptions = agentConfig?.options.sandbox_modes ?? [];
  const branchOptions = agentConfig?.options.branches ?? (selectedBranch ? [selectedBranch] : []);
  const modelValue = selectedModel || modelOptions[0] || "";
  const reasoningValue = selectedReasoningEffort || reasoningOptions[0] || "";
  const approvalValue = selectedApprovalPolicy || approvalOptions[0] || "";
  const sandboxValue = selectedSandboxMode || sandboxOptions[0] || "";
  const branchValue = selectedBranch || branchOptions[0] || "";

  useEffect(() => {
    if (!token && !hasStoredAuthSession()) {
      navigate("/login");
      return;
    }
    if (!sessionId) {
      navigate("/dashboard");
      return;
    }

    void loadSession();
    void loadAgentContext();
    void loadAgentConfig();
    void loadMessages();
    void loadTodos();
  }, [sessionId, token, navigate]);

  useEffect(() => {
    if (!sessionId || !hasStoredAuthSession()) {
      return;
    }

    const socket = createSessionSocket(
      {
        onMessage(message: Message) {
          setMessages((previous) => {
            if (previous.some((item) => item.id === message.id)) {
              return previous;
            }
            return [...previous, message];
          });

          if (isAgentSender(message.sender)) {
            setStreamEvents([]);
            setPendingApproval(null);
            setApprovalSubmitting(null);
            setApprovalError(null);
            void loadAgentContext();
            void loadAgentConfig();
          }
        },
        onStatusChanged(status: string) {
          setSession((previous) => (previous ? { ...previous, runtime_status: status } : previous));
        },
        onStreamEvent(event: CodexStreamEvent) {
          if (event.type === "approval.requested") {
            const data = event.data as Record<string, unknown>;
            setPendingApproval({
              request_id: String(data.request_id ?? ""),
              kind: String(data.kind ?? "command") as PendingApprovalRequest["kind"],
              ...(typeof data.thread_id === "string" ? { thread_id: data.thread_id } : {}),
              ...(typeof data.turn_id === "string" ? { turn_id: data.turn_id } : {}),
              ...(typeof data.item_id === "string" ? { item_id: data.item_id } : {}),
              ...(typeof data.command === "string" ? { command: data.command } : {}),
              ...(typeof data.cwd === "string" ? { cwd: data.cwd } : {}),
              ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
              ...(Array.isArray(data.changes)
                ? {
                    changes: data.changes
                      .filter((change): change is AgentFileTrace => (
                        isRecord(change)
                        && typeof change.path === "string"
                        && typeof change.kind === "string"
                        && ["add", "delete", "update"].includes(change.kind)
                      ))
                      .map((change) => ({
                        path: change.path,
                        kind: change.kind as AgentFileTrace["kind"],
                      })),
                  }
                : {}),
              ...(isRecord(data.permissions)
                ? { permissions: data.permissions }
                : {}),
            });
            setApprovalSubmitting(null);
            setApprovalError(null);
          }

          if (event.type === "approval.resolved") {
            const requestId = String((event.data as Record<string, unknown>).request_id ?? "");
            setPendingApproval((previous) => (
              previous?.request_id === requestId ? null : previous
            ));
            setApprovalSubmitting(null);
            setApprovalError(null);
          }

          if (
            event.type === "thread.started"
            && event.data
            && typeof event.data === "object"
            && "thread_id" in event.data
          ) {
            const threadId = String(event.data.thread_id);
            setSession((previous) => (
              previous ? { ...previous, bound_agent_session_ref: threadId } : previous
            ));
          }

          setStreamEvents((previous) => {
            if (event.type === "item.updated" || event.type === "item.completed") {
              const eventData = event.data as Record<string, unknown>;
              const item = eventData.item as Record<string, unknown> | undefined;
              if (item?.type === "agent_message" || item?.type === "reasoning") {
                const itemId = item.id;
                const filtered = previous.filter((existing) => {
                  const existingData = existing.data as Record<string, unknown>;
                  const existingItem = existingData.item as Record<string, unknown> | undefined;
                  if (existingItem?.type !== item.type) {
                    return true;
                  }
                  return existingItem?.id !== itemId;
                });
                return [...filtered, event];
              }
            }

            return [...previous, event];
          });
        },
        onApprovalError(event) {
          setApprovalSubmitting(null);
          setApprovalError(event.message);
        },
      },
      sessionId,
    );

    socketRef.current = socket;

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [displayMessages, renderedEvents]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [content]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const loadSession = async () => {
    try {
      const response = await getSessionDetail(token!, sessionId!);
      setSession(response.data);
    } catch (err: any) {
      if (err.message === "UNAUTHORIZED" || err.message.includes("401")) {
        clearAuthSession();
        navigate("/login");
        return;
      }
      setError(err.message || "加载会话失败");
    }
  };

  const loadAgentContext = async () => {
    try {
      const response = await getSessionAgentContext(token!, sessionId!);
      setAgentContext(response.data);
    } catch {
      // keep the page usable even if runtime details cannot be fetched yet
    }
  };

  const loadAgentConfig = async () => {
    try {
      const response = await getSessionAgentConfig(token!, sessionId!);
      setAgentConfig(response.data);
      setAgentConfigError(null);
    } catch {
      // keep the page usable even if agent settings cannot be fetched yet
    }
  };

  const handleAgentConfigChange = async (
    patch: Partial<AgentSessionConfig>,
    savingKey: string,
  ) => {
    try {
      setAgentConfigSaving(savingKey);
      setAgentConfigError(null);
      const response = await updateSessionAgentConfig(token!, sessionId!, patch);
      setAgentConfig(response.data);
      await loadAgentContext();
    } catch (err: any) {
      setAgentConfigError(err.message || "更新 Codex 配置失败");
    } finally {
      setAgentConfigSaving(null);
    }
  };

  const loadMessages = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getMessages(token!, sessionId!);
      setMessages(response.data);
    } catch (err: any) {
      if (err.message === "UNAUTHORIZED" || err.message.includes("401")) {
        clearAuthSession();
        navigate("/login");
        return;
      }
      setError(err.message || "加载消息失败");
    } finally {
      setLoading(false);
    }
  };

  const loadTodos = async () => {
    try {
      setTodosLoading(true);
      const response = await getTodos(token!, sessionId!);
      setTodos(response.data);
    } catch {
      // ignore todo loading issues so the main conversation stays usable
    } finally {
      setTodosLoading(false);
    }
  };

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }

    try {
      setSending(true);
      setSendError(null);
      setStreamEvents([]);
      setPendingApproval(null);
      setApprovalSubmitting(null);
      setApprovalError(null);
      const response = await sendMessage(token!, sessionId!, trimmed);
      setMessages((previous) => (
        previous.some((message) => message.id === response.data.message.id)
          ? previous
          : [...previous, response.data.message]
      ));
      setContent("");
    } catch (err: any) {
      setSendError(err.message || "发送消息失败");
    } finally {
      setSending(false);
    }
  };

  const handleApprovalDecision = (decision: "accept" | "decline") => {
    if (!sessionId || !pendingApproval) {
      return;
    }

    if (!socketRef.current) {
      setApprovalError("审批连接不可用，请稍后重试。");
      return;
    }

    setApprovalSubmitting(decision);
    setApprovalError(null);
    socketRef.current.respondToApproval(
      sessionId,
      pendingApproval.request_id,
      decision,
    );
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleToggleReplay = async () => {
    if (replayMode) {
      setReplayMode(false);
      setReplayMessages([]);
      return;
    }

    try {
      setReplayLoading(true);
      const response = await getReplay(token!, sessionId!);
      const mappedMessages = response.data
        .map(mapReplayEntryToMessage)
        .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
      setReplayMessages(mappedMessages);
      setReplayMode(true);
    } catch (err: any) {
      setError(err.message || "加载回放失败");
    } finally {
      setReplayLoading(false);
    }
  };

  const handleNewTodoClick = (messageId: string) => {
    setNewTodoMessageId(messageId);
    setNewTodoTitle("");
    setTodoError(null);
    focusMessage(messageId);
  };

  const handleCancelTodo = () => {
    setNewTodoMessageId(null);
    setNewTodoTitle("");
    setTodoError(null);
  };

  const handleCreateTodo = async (messageId: string) => {
    const trimmed = newTodoTitle.trim();
    if (!trimmed) {
      return;
    }

    try {
      setTodoCreating(true);
      setTodoError(null);
      const response = await createTodo(token!, sessionId!, messageId, trimmed);
      setTodos((previous) => [...previous, response.data]);
      setNewTodoMessageId(null);
      setNewTodoTitle("");
    } catch (err: any) {
      setTodoError(err.message || "创建待办失败");
    } finally {
      setTodoCreating(false);
    }
  };

  const handleToggleTodoStatus = async (todo: Todo) => {
    if (replayMode) {
      return;
    }

    const nextStatus: TodoStatus = todo.status === "completed" ? "pending" : "completed";
    try {
      const response = await updateTodoStatus(token!, todo.id, nextStatus);
      setTodos((previous) => previous.map((item) => (item.id === todo.id ? response.data : item)));
    } catch {
      // ignore transient todo update issues
    }
  };

  const focusMessage = (messageId: string) => {
    const target = messageRefs.current[messageId];
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
    }, 1800);
  };

  if (loading && !session) {
    return <PageLoading label="加载会话中..." />;
  }

  if (error && !session) {
    return (
      <PageShell
        title="错误"
        backTo={sessionBackTo}
        className="session-page-shell pt-4 sm:pt-6"
      >
        <GlassCard className="session-surface-card">
          <p className="session-inline-error">{error}</p>
        </GlassCard>
      </PageShell>
    );
  }

  return (
    <PageShell
      backTo={sessionBackTo}
      fullHeight
      className="session-page-shell pt-4 sm:pt-5"
    >
      <div className="session-page">
        <GlassCard className="session-topbar" as="section">
          <div className="session-topbar__main">
            <div className="session-topbar__title-row">
              <h1 className="session-topbar__title">{session?.title ?? "会话"}</h1>
              {session?.runtime_status && (
                <Badge variant="accent">{formatRuntimeStatus(session.runtime_status)}</Badge>
              )}
              <Badge variant={session?.visibility === "private" ? "warning" : "success"}>
                {session?.visibility === "private" ? "私有" : "共享"}
              </Badge>
              {replayMode && <Badge variant="warning">回放模式</Badge>}
            </div>
            <div className="session-topbar__meta">
              <span className="session-topbar__meta-item">
                线程 ID
                <code>{displayAgentRuntime?.thread_id ?? codexThreadId ?? "等待首次同步"}</code>
              </span>
              <span className="session-topbar__meta-item">
                更新时间
                <strong>{session ? formatDateTime(session.updated_at) : "-"}</strong>
              </span>
            </div>
            <div className="session-settings-row">
              <label className="session-setting-inline">
                <span className="session-setting-inline__label">模型</span>
                <select
                  className="session-setting-inline__control"
                  value={modelValue}
                  disabled={agentConfigSaving !== null || modelOptions.length === 0}
                  onChange={(event) => void handleAgentConfigChange(
                    { model: event.target.value },
                    "model",
                  )}
                >
                  {modelOptions.length === 0 ? (
                    <option value="">暂无模型</option>
                  ) : (
                    modelOptions.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))
                  )}
                </select>
              </label>
              <label className="session-setting-inline">
                <span className="session-setting-inline__label">思考</span>
                <select
                  className="session-setting-inline__control"
                  value={reasoningValue}
                  disabled={agentConfigSaving !== null || reasoningOptions.length === 0}
                  onChange={(event) => void handleAgentConfigChange(
                    { reasoning_effort: event.target.value },
                    "reasoning",
                  )}
                >
                  {reasoningOptions.length === 0 ? (
                    <option value="">暂无思考强度</option>
                  ) : (
                    reasoningOptions.map((effort) => (
                      <option key={effort} value={effort}>
                        {formatReasoningEffort(effort)}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="session-setting-inline">
                <span className="session-setting-inline__label">审批</span>
                <select
                  className="session-setting-inline__control"
                  value={approvalValue}
                  disabled={agentConfigSaving !== null || approvalOptions.length === 0}
                  onChange={(event) => void handleAgentConfigChange(
                    { approval_policy: event.target.value },
                    "approval",
                  )}
                >
                  {approvalOptions.length === 0 ? (
                    <option value="">暂无审批策略</option>
                  ) : (
                    approvalOptions.map((policy) => (
                      <option key={policy} value={policy}>
                        {formatApprovalPolicy(policy)}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="session-setting-inline">
                <span className="session-setting-inline__label">沙箱</span>
                <select
                  className="session-setting-inline__control"
                  value={sandboxValue}
                  disabled={agentConfigSaving !== null || sandboxOptions.length === 0}
                  onChange={(event) => void handleAgentConfigChange(
                    { sandbox_mode: event.target.value },
                    "sandbox",
                  )}
                >
                  {sandboxOptions.length === 0 ? (
                    <option value="">暂无沙箱模式</option>
                  ) : (
                    sandboxOptions.map((mode) => (
                      <option key={mode} value={mode}>
                        {formatSandboxMode(mode)}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="session-setting-inline">
                <span className="session-setting-inline__label">分支</span>
                <select
                  className="session-setting-inline__control"
                  value={branchValue}
                  disabled={agentConfigSaving !== null || branchOptions.length === 0}
                  onChange={(event) => void handleAgentConfigChange(
                    { branch: event.target.value },
                    "branch",
                  )}
                >
                  {branchOptions.length === 0 ? (
                    <option value="">暂无分支</option>
                  ) : (
                    branchOptions.map((branch) => (
                      <option key={branch} value={branch}>{branch}</option>
                    ))
                  )}
                </select>
              </label>
              <div className="session-setting-inline session-setting-inline--path">
                <span className="session-setting-inline__label">工作目录</span>
                <code className="session-setting-inline__code">
                  {displayAgentRuntime?.working_directory ?? "项目未配置工作目录"}
                </code>
              </div>
            </div>
            <div className="session-settings-hint">
              <span>提供方 {displayAgentRuntime?.model_provider ?? "未知"}</span>
              <span>CLI {displayAgentRuntime?.cli_version ?? "-"}</span>
              <span>运行时审批 {formatApprovalPolicy(displayAgentRuntime?.approval_policy)}</span>
              <span>网络 {formatNetworkAccess(displayAgentRuntime?.network_access)}</span>
              <span>来源 {displayAgentRuntime?.source ?? "-"}</span>
              {agentConfigSaving && <span>保存中...</span>}
            </div>
            {agentConfigError && (
              <div className="session-inline-error">{agentConfigError}</div>
            )}
          </div>
          <div className="session-topbar__actions">
            <button
              type="button"
              className="session-button session-button--secondary"
              onClick={handleToggleReplay}
              disabled={replayLoading}
            >
              {replayLoading ? "加载中..." : replayMode ? "退出回放" : "查看回放"}
            </button>
          </div>
        </GlassCard>

        <div className={`session-layout ${todoPanelCollapsed ? "session-layout--todo-collapsed" : ""}`}>
          <GlassCard className="session-conversation-panel" as="section">
            <div className="session-panel-header">
              <h2 className="session-section-header__title">消息区</h2>
              <div className="session-chip-row">
                <span className={`session-chip ${hasBusyStream ? "session-chip--active" : ""}`}>
                  {hasBusyStream ? "助手处理中" : "空闲中"}
                </span>
              </div>
            </div>

            {replayMode && (
              <div className="session-banner session-banner--warning">
                当前是回放模式：输入、待办更新和实时处理都会保持只读。
              </div>
            )}
            {error && session && (
              <div className="session-banner session-banner--danger">{error}</div>
            )}

            <div className="session-feed-scroll">
              {displayMessages.length === 0 && !showLiveStream ? (
                <div className="session-empty-state">
                  <div className="session-empty-state__icon">聊</div>
                  <h3>还没有消息</h3>
                  <p>先发出第一条协作指令，助手的实时处理会直接在这里展开。</p>
                </div>
              ) : (
                <div className="session-message-list">
                  {displayMessages.map((message) => {
                    const presenter = getMessagePresenter(message);
                    const isHighlighted = highlightedMessageId === message.id;
                    const metadata = parseAgentMetadata(message.metadata);
                    const commands = metadata?.execution_trace?.commands ?? [];
                    const files = metadata?.execution_trace?.files ?? [];
                    const diffs = metadata?.execution_trace?.file_diffs ?? [];
                    const usage = metadata?.usage;
                    const usageSummary = formatUsageSummary(usage);

                    return (
                      <article
                        key={message.id}
                        ref={(node) => {
                          messageRefs.current[message.id] = node;
                        }}
                        className={[
                          "session-message-row",
                          presenter.tone === "agent" ? "session-message-row--agent" : "session-message-row--human",
                          isHighlighted ? "session-message-row--highlight" : "",
                        ].join(" ").trim()}
                      >
                        <div className={`session-message-avatar session-message-avatar--${presenter.tone}`}>
                          {presenter.avatarText}
                        </div>
                        <div className="session-message-content">
                          <div className={`session-message-card session-message-card--${presenter.tone}`}>
                            <div className="session-message-card__top">
                            <div>
                              <div className="session-message-card__author">{presenter.label}</div>
                            </div>
                            <time className="session-message-card__time" dateTime={message.created_at}>
                              {formatClock(message.created_at)}
                            </time>
                          </div>
                          {hasExecutionDetails(metadata) && (
                            <div className="session-execution">
                              {commands.length > 0 && (
                                <div className="session-execution__section">
                                  <div className="session-command-list">
                                    {commands.map((command, index) => {
                                      const duration = formatDuration(command.duration_ms);
                                      return (
                                        <details
                                          key={`${message.id}-command-${index}`}
                                          className="session-command-card"
                                        >
                                          <summary className="session-command-card__summary">
                                            <code className="session-command-card__command">{command.command}</code>
                                            <div className="session-command-card__badges">
                                              <span className={`session-command-badge ${command.exit_code === 0 ? "session-command-badge--success" : command.exit_code != null ? "session-command-badge--danger" : ""}`}>
                                                {formatCommandStatus(command.status)}
                                              </span>
                                              {command.exit_code != null && (
                                                <span className="session-command-badge">退出 {command.exit_code}</span>
                                              )}
                                              {duration && (
                                                <span className="session-command-badge">{duration}</span>
                                              )}
                                              <span className="session-command-card__toggle" aria-hidden="true" />
                                            </div>
                                          </summary>
                                          <div className="session-command-card__details">
                                            {command.cwd && (
                                              <div className="session-command-card__cwd">
                                                <span>工作目录</span>
                                                <code>{command.cwd}</code>
                                              </div>
                                            )}
                                            {command.output ? (
                                              <pre className="session-command-output">{command.output}</pre>
                                            ) : (
                                              <div className="session-execution__empty">未采集到命令输出。</div>
                                            )}
                                          </div>
                                        </details>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {files.length > 0 && (
                                <div className="session-execution__section">
                                  <div className="session-execution__title">改动文件</div>
                                  <div className="session-file-list">
                                    {files.map((file) => (
                                      <div
                                        key={`${message.id}-${file.path}-${file.kind}`}
                                        className={`session-file-chip session-file-chip--${file.kind}`}
                                      >
                                        <span className="session-file-chip__kind">{formatFileKind(file.kind)}</span>
                                        <code>{file.path}</code>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {diffs.length > 0 && (
                                <div className="session-execution__section">
                                  <div className="session-execution__title">改动点 Diff</div>
                                  <div className="session-diff-list">
                                    {diffs.map((diff, index) => (
                                      <div key={`${message.id}-diff-${index}`} className="session-diff-card">
                                        <div className="session-diff-card__header">
                                          <code>{diff.path}</code>
                                          <span className={`session-file-chip session-file-chip--${diff.kind}`}>
                                            <span className="session-file-chip__kind">{formatFileKind(diff.kind)}</span>
                                          </span>
                                        </div>
                                        <div className="session-diff-pre">
                                          {diff.patch.split(/\r?\n/u).map((line, lineIndex) => (
                                            <div
                                              key={`${message.id}-diff-${index}-line-${lineIndex}`}
                                              className={getDiffLineClass(line)}
                                            >
                                              {line || " "}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                            </div>
                          )}

                          <div className="session-message-card__body">{message.content}</div>

                          {!replayMode && (
                            <div className="session-message-card__footer">
                              <button
                                type="button"
                                className="session-inline-link"
                                onClick={() => handleNewTodoClick(message.id)}
                              >
                                从这条消息创建待办
                              </button>
                            </div>
                          )}

                          {newTodoMessageId === message.id && !replayMode && (
                            <div className="session-inline-form">
                              <div className="session-inline-form__header">新建待办</div>
                              {todoError && <div className="session-inline-error">{todoError}</div>}
                              <div className="session-inline-form__row">
                                <input
                                  value={newTodoTitle}
                                  onChange={(event) => setNewTodoTitle(event.target.value)}
                                  placeholder="例如：整理这条消息对应的执行步骤"
                                  className="session-text-input"
                                  disabled={todoCreating}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      void handleCreateTodo(message.id);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="session-button session-button--primary"
                                  onClick={() => void handleCreateTodo(message.id)}
                                  disabled={todoCreating || !newTodoTitle.trim()}
                                >
                                  {todoCreating ? "添加中..." : "添加"}
                                </button>
                                <button
                                  type="button"
                                  className="session-button session-button--ghost"
                                  onClick={handleCancelTodo}
                                  disabled={todoCreating}
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}
                          </div>
                          {usageSummary && presenter.tone === "agent" && (
                            <div className="session-message-row__hover-meta">{usageSummary}</div>
                          )}
                        </div>
                      </article>
                    );
                  })}

                  {showLiveStream && (
                    <article className="session-message-row session-message-row--agent session-message-row--live">
                      <div className="session-message-avatar session-message-avatar--agent">流</div>
                      <div className="session-message-card session-message-card--agent session-live-card">
                        <div className="session-live-card__header">
                          <div>
                            <div className="session-message-card__author">协作助手</div>
                            <div className="session-message-card__meta">
                              {hasBusyStream ? "正在处理这一轮消息" : "等待最终回复入列"}
                            </div>
                          </div>
                          <span className={`session-live-card__badge ${hasBusyStream ? "session-live-card__badge--active" : ""}`}>
                            {hasBusyStream ? "实时处理中" : "即将完成"}
                          </span>
                        </div>

                        {hiddenEventCount > 0 && (
                          <div className="session-live-card__summary">
                            已折叠较早的 {hiddenEventCount} 条处理记录
                          </div>
                        )}

                        {visibleEvents.length === 0 ? (
                          <div className="session-live-card__empty">
                            <span className="session-live-card__pulse" />
                            <span>等待实时事件...</span>
                          </div>
                        ) : (
                          <div className="session-live-list">
                            {visibleEvents.map((event) => (
                              <div key={event.id} className={`session-stream-item session-stream-item--${event.tone}`}>
                                <span className={`session-stream-item__icon ${event.spinning ? "session-stream-item__icon--spinning" : ""}`}>
                                  {event.icon}
                                </span>
                                <span className="session-stream-item__text">{event.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {!replayMode && (
              <form className="session-composer" onSubmit={handleSend}>
                {sendError && <div className="session-banner session-banner--danger">{sendError}</div>}

                <div className="session-composer__row">
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="输入消息...（Enter 发送，Shift+Enter 换行）"
                    className="session-composer__input"
                    disabled={sending}
                    rows={1}
                  />
                  <button
                    type="submit"
                    className="session-button session-button--primary session-composer__submit"
                    disabled={sending || !content.trim()}
                  >
                    {sending ? "发送中..." : "发送"}
                  </button>
                </div>
              </form>
            )}
          </GlassCard>

          <aside className="session-rail">
            <GlassCard
              className={`session-rail-card ${todoPanelCollapsed ? "session-rail-card--collapsed" : ""}`}
              as="section"
            >
              <div className="session-section-header session-section-header--compact">
                <div className="session-rail-card__title-wrap">
                  <h2 className="session-section-header__title">待办</h2>
                </div>
                <div className="session-rail-card__header-actions">
                  {!todoPanelCollapsed && <span className="session-chip">未完成 {pendingTodos.length}</span>}
                  <button
                    type="button"
                    className={`session-collapse-toggle ${todoPanelCollapsed ? "session-collapse-toggle--collapsed" : ""}`}
                    onClick={() => setTodoPanelCollapsed((previous) => !previous)}
                    aria-label={todoPanelCollapsed ? "展开待办区域" : "收起待办区域"}
                    aria-expanded={!todoPanelCollapsed}
                    title={todoPanelCollapsed ? "展开待办区域" : "收起待办区域"}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4.47 6.22a.75.75 0 0 1 1.06 0L8 8.69l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z" />
                    </svg>
                  </button>
                </div>
              </div>

              {!todoPanelCollapsed && (
                <div className="session-rail-card__body">
                  {todosLoading ? (
                    <div className="session-empty-card session-empty-card--compact">
                      <div className="session-empty-card__icon">办</div>
                      <p>待办加载中...</p>
                    </div>
                  ) : sortedTodos.length === 0 ? (
                    <div className="session-empty-card session-empty-card--compact">
                      <div className="session-empty-card__icon">办</div>
                      <p>还没有待办，可在消息下方快速创建。</p>
                    </div>
                  ) : (
                    <div className="session-todo-preview-list">
                      {sortedTodos.map((todo) => (
                        <div
                          key={todo.id}
                          className={`session-todo-card ${todo.status === "completed" ? "session-todo-card--done" : ""}`}
                        >
                          <div className="session-todo-card__top">
                            <span className={`session-status-pill ${todo.status === "completed" ? "session-status-pill--done" : "session-status-pill--pending"}`}>
                              {todo.status === "completed" ? "已完成" : "待处理"}
                            </span>
                            <div className="session-todo-card__actions">
                              <button
                                type="button"
                                className="session-inline-link"
                                onClick={() => focusMessage(todo.source_message_id)}
                              >
                                定位消息
                              </button>
                            </div>
                          </div>
                          <div className="session-todo-card__title">{todo.title}</div>
                          <div className="session-todo-card__meta">创建于 {formatDateTime(todo.created_at)}</div>
                          <button
                            type="button"
                            className={`session-button ${todo.status === "pending" ? "session-button--primary" : "session-button--secondary"}`}
                            onClick={() => void handleToggleTodoStatus(todo)}
                            disabled={replayMode}
                          >
                            {todo.status === "pending" ? "标记完成" : "重新打开"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </GlassCard>
          </aside>
        </div>
      </div>
      {pendingApproval && (
        <div className="session-approval-backdrop">
          <div className="session-approval-dialog">
            <div className="session-approval-dialog__eyebrow">需要审批</div>
            <div className="session-approval-dialog__title">
              {formatApprovalKind(pendingApproval.kind)}
            </div>
            {pendingApproval.reason && (
              <div className="session-approval-dialog__reason">{pendingApproval.reason}</div>
            )}

            {pendingApproval.command && (
              <div className="session-approval-dialog__block">
                <span className="session-approval-dialog__label">命令</span>
                <code className="session-approval-dialog__code">{pendingApproval.command}</code>
              </div>
            )}

            {pendingApproval.cwd && (
              <div className="session-approval-dialog__block">
                <span className="session-approval-dialog__label">工作目录</span>
                <code className="session-approval-dialog__code">{pendingApproval.cwd}</code>
              </div>
            )}

            {pendingApproval.changes && pendingApproval.changes.length > 0 && (
              <div className="session-approval-dialog__block">
                <span className="session-approval-dialog__label">拟改动文件</span>
                <div className="session-file-list">
                  {pendingApproval.changes.map((file) => (
                    <div
                      key={`${file.path}-${file.kind}`}
                      className={`session-file-chip session-file-chip--${file.kind}`}
                    >
                      <span className="session-file-chip__kind">{formatFileKind(file.kind)}</span>
                      <code>{file.path}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pendingApproval.permissions && (
              <div className="session-approval-dialog__block">
                <span className="session-approval-dialog__label">权限请求</span>
                <pre className="session-approval-dialog__json">
                  {JSON.stringify(pendingApproval.permissions, null, 2)}
                </pre>
              </div>
            )}

            {approvalError && (
              <div className="session-inline-error">{approvalError}</div>
            )}

            <div className="session-approval-dialog__actions">
              <button
                type="button"
                className="session-button session-button--ghost"
                onClick={() => handleApprovalDecision("decline")}
                disabled={approvalSubmitting !== null}
              >
                {approvalSubmitting === "decline" ? "拒绝中..." : "拒绝"}
              </button>
              <button
                type="button"
                className="session-button session-button--primary"
                onClick={() => handleApprovalDecision("accept")}
                disabled={approvalSubmitting !== null}
              >
                {approvalSubmitting === "accept" ? "批准中..." : "批准"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
