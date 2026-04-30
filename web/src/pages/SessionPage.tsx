import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  clearAuthSession,
  createTodo,
  getMessages,
  getReplay,
  getSessionDetail,
  getStoredAuthToken,
  getTodos,
  hasStoredAuthSession,
  sendMessage,
  updateTodoStatus,
} from "../api/client.js";
import type { Message, ReplayEntry, SessionDetail, Todo, TodoStatus } from "../api/client.js";
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
  secondaryLabel: string;
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

  const secondaryLabel = agent
    ? "助手回复"
    : enriched.sender_role === "admin"
      ? "管理员"
      : enriched.sender_role === "member"
        ? "协作成员"
        : "共享会话成员";

  return {
    id: enriched.sender_user_id ?? enriched.author_id ?? label,
    label,
    secondaryLabel,
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

    case "reasoning":
      return {
        id: rowId,
        icon: "思",
        text: String(item.text ?? "").slice(0, 220),
        tone: "neutral",
        spinning,
      };

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

  const [streamEvents, setStreamEvents] = useState<CodexStreamEvent[]>([]);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

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
  const previewTodos = sortedTodos.slice(0, 4);
  const hiddenTodoCount = Math.max(sortedTodos.length - previewTodos.length, 0);
  const visibleEvents = renderedEvents.slice(-10);
  const hiddenEventCount = Math.max(renderedEvents.length - visibleEvents.length, 0);
  const showLiveStream = !replayMode && (sending || renderedEvents.length > 0);

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
          }
        },
        onStatusChanged(status: string) {
          setSession((previous) => (previous ? { ...previous, runtime_status: status } : previous));
        },
        onStreamEvent(event: CodexStreamEvent) {
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
              if (item?.type === "agent_message") {
                const itemId = item.id;
                const filtered = previous.filter((existing) => {
                  const existingData = existing.data as Record<string, unknown>;
                  const existingItem = existingData.item as Record<string, unknown> | undefined;
                  if (existingItem?.type !== "agent_message") {
                    return true;
                  }
                  return existingItem?.id === itemId;
                });
                return [...filtered, event];
              }
            }

            return [...previous, event];
          });
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
                <code>{codexThreadId ?? "等待首次同步"}</code>
              </span>
              <span className="session-topbar__meta-item">
                更新时间
                <strong>{session ? formatDateTime(session.updated_at) : "-"}</strong>
              </span>
            </div>
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

        <div className="session-layout">
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
                        <div className={`session-message-card session-message-card--${presenter.tone}`}>
                          <div className="session-message-card__top">
                            <div>
                              <div className="session-message-card__author">{presenter.label}</div>
                            </div>
                            <time className="session-message-card__time" dateTime={message.created_at}>
                              {formatClock(message.created_at)}
                            </time>
                          </div>

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
            <GlassCard className="session-rail-card" as="section">
              <div className="session-section-header session-section-header--compact">
                <div>
                  <h2 className="session-section-header__title">待办</h2>
                </div>
                <span className="session-chip">未完成 {pendingTodos.length}</span>
              </div>

              {todosLoading ? (
                <div className="session-empty-card session-empty-card--compact">
                  <div className="session-empty-card__icon">办</div>
                  <p>待办加载中...</p>
                </div>
              ) : previewTodos.length === 0 ? (
                <div className="session-empty-card session-empty-card--compact">
                  <div className="session-empty-card__icon">办</div>
                  <p>还没有待办，可在消息下方快速创建。</p>
                </div>
              ) : (
                <div className="session-todo-preview-list">
                  {previewTodos.map((todo) => (
                    <div key={todo.id} className={`session-todo-card ${todo.status === "completed" ? "session-todo-card--done" : ""}`}>
                      <div className="session-todo-card__top">
                        <span className={`session-status-pill ${todo.status === "completed" ? "session-status-pill--done" : "session-status-pill--pending"}`}>
                          {todo.status === "completed" ? "已完成" : "待处理"}
                        </span>
                        <button
                          type="button"
                          className="session-inline-link"
                          onClick={() => focusMessage(todo.source_message_id)}
                        >
                          定位消息
                        </button>
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
                  {hiddenTodoCount > 0 && (
                    <div className="session-rail-note">还有 {hiddenTodoCount} 项待办未展示，消息区仍可继续创建与定位。</div>
                  )}
                </div>
              )}
            </GlassCard>
          </aside>
        </div>
      </div>
    </PageShell>
  );
}
