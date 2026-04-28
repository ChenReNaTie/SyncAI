import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getSessionDetail,
  getMessages,
  sendMessage,
  getReplay,
  getTodos,
  createTodo,
  updateTodoStatus,
} from "../api/client.js";
import { createSessionSocket } from "../api/socket.js";
import type { SocketStreamEvent } from "../api/socket.js";
import type { SessionDetail, Message, Todo, TodoStatus } from "../api/client.js";
import { PageShell, GlassCard, Button, Input, Badge, PageLoading } from "../components/index.js";

/* ------------------------------------------------------------------ */
/*  Stream event types (mirrors Codex SDK ThreadEvent / ThreadItem)    */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Stream-event → UI helper                                           */
/* ------------------------------------------------------------------ */

interface RenderedEvent {
  id: string;
  icon: string;
  text: string;
  color: string;
  spinning: boolean;
}

let _eventSeq = 0;

function renderStreamEvent(ev: CodexStreamEvent): RenderedEvent | null {
  const d = ev.data ?? {};
  const data = d as Record<string, unknown>;
  const item = data.item as Record<string, unknown> | undefined;

  switch (ev.type) {
    // ── Thread-level events ──
    case "thread.started":
      return {
        id: `th-${++_eventSeq}`,
        icon: "🧵",
        text: `Thread started: ${String(data.thread_id ?? "—")}`,
        color: "text-text-muted",
        spinning: false,
      };

    case "turn.started":
      return {
        id: `ts-${++_eventSeq}`,
        icon: "🔄",
        text: "Turn started",
        color: "text-text-muted",
        spinning: true,
      };

    case "turn.completed": {
      const usage = data.usage as Record<string, number> | undefined;
      const input = usage?.input_tokens ?? 0;
      const cached = usage?.cached_input_tokens ?? 0;
      const output = usage?.output_tokens ?? 0;
      return {
        id: `tc-${++_eventSeq}`,
        icon: "📊",
        text: `Turn completed — ${input + output} tokens (in: ${input}, cached: ${cached}, out: ${output})`,
        color: "text-accent-light",
        spinning: false,
      };
    }

    case "turn.failed": {
      const errMsg =
        data.error && typeof data.error === "object"
          ? (data.error as Record<string, unknown>).message
          : "Unknown error";
      return {
        id: `tf-${++_eventSeq}`,
        icon: "❌",
        text: `Turn failed: ${String(errMsg)}`,
        color: "text-danger",
        spinning: false,
      };
    }

    // ── Error event (stream-level) ──
    case "error":
      return {
        id: `err-${++_eventSeq}`,
        icon: "⚠️",
        text: `Error: ${String(data.message ?? "Unknown")}`,
        color: "text-danger",
        spinning: false,
      };

    // ── Item events ──
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
  if (!item) return null;

  const id = String(item.id ?? ++_eventSeq);
  const itemType = String(item.type ?? "") as ItemType;
  const status = String(item.status ?? "");
  const spinning = status === "in_progress";

  const itemId = `${itemType}-${id}-${phase}`;

  switch (itemType) {
    case "command_execution": {
      const command = String(item.command ?? "").slice(0, 80);
      const exitCode = item.exit_code != null ? Number(item.exit_code) : undefined;
      const isOk = exitCode === 0;

      if (status === "completed" && isOk) {
        return { id: itemId, icon: "✓", text: command, color: "text-success", spinning: false };
      }
      if (status === "completed" || status === "failed") {
        return { id: itemId, icon: "✗", text: command, color: "text-danger", spinning: false };
      }
      // in_progress
      return { id: itemId, icon: "🔄", text: command, color: "text-accent-light", spinning: true };
    }

    case "agent_message": {
      const text = String(item.text ?? "");
      // Only show completed/updated — started has no content yet
      if (phase === "started") {
        return { id: itemId, icon: "💬", text: "Generating…", color: "text-accent-light", spinning: true };
      }
      return { id: itemId, icon: "💬", text, color: "text-text-primary", spinning: false };
    }

    case "reasoning": {
      const text = String(item.text ?? "").slice(0, 200);
      return { id: itemId, icon: "🧠", text, color: "text-text-secondary", spinning };
    }

    case "file_change": {
      const changes = item.changes as Array<{ path: string; kind: string }> | undefined;
      const paths = changes?.map((c) => {
        const kindIcon = c.kind === "add" ? "+" : c.kind === "delete" ? "🗑" : "✎";
        return `${kindIcon} ${c.path}`;
      }).join("  ") ?? "";
      const suffix = status === "failed" ? " (failed)" : "";
      return {
        id: itemId,
        icon: "📝",
        text: `${paths}${suffix}`,
        color: status === "failed" ? "text-danger" : "text-text-primary",
        spinning: status === "in_progress",
      };
    }

    case "mcp_tool_call": {
      const server = String(item.server ?? "");
      const tool = String(item.tool ?? "");
      const resultStr = item.result ? " ✓" : "";
      const err = item.error ? ` ❌ ${String(item.error)}` : "";
      return {
        id: itemId,
        icon: "🔌",
        text: `${server}:${tool}${resultStr}${err}`.slice(0, 120),
        color: item.error ? "text-danger" : "text-accent-light",
        spinning: status === "in_progress",
      };
    }

    case "web_search": {
      const query = String(item.query ?? "");
      return {
        id: itemId,
        icon: "🔍",
        text: query.slice(0, 100),
        color: "text-text-secondary",
        spinning: false,
      };
    }

    case "todo_list": {
      const items = item.items as Array<{ text: string; completed: boolean }> | undefined;
      const list = items?.map((t) => `${t.completed ? "☑" : "☐"} ${t.text}`).join("  ") ?? "";
      return {
        id: itemId,
        icon: "📋",
        text: list.slice(0, 150),
        color: "text-text-secondary",
        spinning: false,
      };
    }

    case "error": {
      return {
        id: itemId,
        icon: "⚠️",
        text: String(item.message ?? "Unknown item error").slice(0, 120),
        color: "text-danger",
        spinning: false,
      };
    }

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamListRef = useRef<HTMLDivElement>(null);

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

  // Live stream events for the current processing round
  const [streamEvents, setStreamEvents] = useState<CodexStreamEvent[]>([]);
  const [streamCollapsed, setStreamCollapsed] = useState(false);

  const token = localStorage.getItem("token");
  const socketRef = useRef<ReturnType<typeof createSessionSocket> | null>(null);

  useEffect(() => {
    if (!token) { navigate("/login"); return; }
    if (!sessionId) { navigate("/dashboard"); return; }
    loadSession();
    loadMessages();
    loadTodos();
  }, [sessionId, token, navigate]);

  useEffect(() => {
    if (!token || !sessionId) return;
    const socket = createSessionSocket(
      token,
      {
        onMessage(msg: Message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          // Agent message arrived → clear stream events
          if (msg.sender === "agent" || msg.sender !== "user") {
            setStreamEvents([]);
          }
        },
        onStatusChanged(status: string) {
          setSession((prev) => (prev ? { ...prev, runtime_status: status } : prev));
        },
        onStreamEvent(ev: CodexStreamEvent) {
          setStreamEvents((prev) => {
            // For agent_message items, replace previous partial updates for the same item
            if (
              ev.type === "item.updated" ||
              ev.type === "item.completed"
            ) {
              const evData = ev.data as Record<string, unknown>;
              const item = evData?.item as Record<string, unknown> | undefined;
              if (item?.type === "agent_message") {
                const itemId = item.id;
                const filtered = prev.filter((p) => {
                  const pd = p.data as Record<string, unknown>;
                  const pi = pd?.item as Record<string, unknown> | undefined;
                  // Keep non-agent_message items and the same item id
                  if (pi?.type !== "agent_message") return true;
                  return pi?.id === itemId;
                });
                return [...filtered, ev];
              }
            }
            return [...prev, ev];
          });
        },
      },
      sessionId, // auto-subscribe as soon as the socket opens
    );
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [token, sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, replayMessages, streamEvents]);

  // Auto-scroll stream card to bottom when new events arrive
  useEffect(() => {
    if (streamListRef.current) {
      streamListRef.current.scrollTop = streamListRef.current.scrollHeight;
    }
  }, [streamEvents]);

  const loadSession = async () => {
    try {
      const res = await getSessionDetail(token!, sessionId!);
      setSession(res.data);
    } catch (err: any) {
      if (err.message === "UNAUTHORIZED" || err.message.includes("401")) {
        localStorage.removeItem("token"); navigate("/login"); return;
      }
      setError(err.message || "Failed to load session");
    }
  };

  const loadMessages = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getMessages(token!, sessionId!);
      setMessages(res.data);
    } catch (err: any) {
      if (err.message === "UNAUTHORIZED" || err.message.includes("401")) {
        localStorage.removeItem("token"); navigate("/login"); return;
      }
      setError(err.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  };

  const loadTodos = async () => {
    try {
      setTodosLoading(true);
      const res = await getTodos(token!, sessionId!);
      setTodos(res.data);
    } catch {
      // silently ignore
    } finally {
      setTodosLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      setSending(true);
      setSendError(null);
      // Clear previous stream events for the new round
      setStreamEvents([]);
      const res = await sendMessage(token!, sessionId!, trimmed);
      setMessages((prev) => [...prev, res.data.message]);
      setContent("");
    } catch (err: any) {
      setSendError(err.message || "Failed to send message");
    } finally {
      setSending(false);
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
      const res = await getReplay(token!, sessionId!);
      const sorted = [...res.data].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      setReplayMessages(sorted);
      setReplayMode(true);
    } catch (err: any) {
      setError(err.message || "Failed to load replay");
    } finally {
      setReplayLoading(false);
    }
  };

  const handleNewTodoClick = (messageId: string) => {
    setNewTodoMessageId(messageId);
    setNewTodoTitle("");
    setTodoError(null);
  };

  const handleCancelTodo = () => {
    setNewTodoMessageId(null);
    setNewTodoTitle("");
    setTodoError(null);
  };

  const handleCreateTodo = async (messageId: string) => {
    const trimmed = newTodoTitle.trim();
    if (!trimmed) return;
    try {
      setTodoCreating(true);
      setTodoError(null);
      const res = await createTodo(token!, sessionId!, messageId, trimmed);
      setTodos((prev) => [...prev, res.data]);
      setNewTodoMessageId(null);
      setNewTodoTitle("");
    } catch (err: any) {
      setTodoError(err.message || "Failed to create todo");
    } finally {
      setTodoCreating(false);
    }
  };

  const handleToggleTodoStatus = async (todo: Todo) => {
    const nextStatus: TodoStatus = todo.status === "done" ? "pending" : "done";
    try {
      const res = await updateTodoStatus(token!, todo.id, nextStatus);
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? res.data : t)));
    } catch {
      // silently ignore
    }
  };

  const displayMessages = replayMode ? replayMessages : messages;
  const projectLink = session?.project_id ? `/projects/${session.project_id}` : "/dashboard";

  // Render stream events into UI rows
  const renderedEvents = streamEvents
    .map(renderStreamEvent)
    .filter((r): r is RenderedEvent => r !== null);

  if (loading && !session) return <PageLoading label="Loading session..." />;

  if (error && !session) {
    return (
      <PageShell title="Error" backTo={{ label: "返回 Dashboard", href: "/dashboard" }}>
        <GlassCard>
          <p className="text-danger">{error}</p>
        </GlassCard>
      </PageShell>
    );
  }

  return (
    <PageShell
      backTo={{ label: "返回项目", href: projectLink }}
      fullHeight
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-xl font-bold text-text-primary truncate">
            {session?.title ?? "Session"}
          </h1>
          {session?.runtime_status && (
            <Badge variant="accent">{session.runtime_status}</Badge>
          )}
          {replayMode && (
            <Badge variant="warning">REPLAY</Badge>
          )}
        </div>
        <Button
          variant={replayMode ? "secondary" : "ghost"}
          size="sm"
          onClick={handleToggleReplay}
          loading={replayLoading}
        >
          {replayMode ? "退出回放" : "Replay"}
        </Button>
      </div>

      {/* Messages Area */}
      <GlassCard className="flex-1 min-h-0 flex flex-col mb-4 overflow-hidden">
        <div className="flex-1 overflow-y-auto -mx-6 -mt-6 px-6 pt-6 pb-2">
          {displayMessages.length === 0 && renderedEvents.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-12">还没有消息，开始对话吧！</p>
          ) : (
            <div className="flex flex-col gap-1">
              {displayMessages.map((msg) => {
                const isUser = msg.sender === "user" || msg.sender !== "ai";
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}
                  >
                    <div
                      className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                        isUser
                          ? "bg-accent-muted border border-accent/20 rounded-br-md"
                          : "bg-surface-2 border border-glass-border rounded-bl-md"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={`text-xs font-medium ${isUser ? "text-accent-light" : "text-text-muted"}`}>
                          {msg.sender}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-sm text-text-primary whitespace-pre-wrap break-words leading-relaxed">
                        {msg.content}
                      </p>

                      {/* Todo button */}
                      {!replayMode && (
                        <div className="flex gap-2 mt-2">
                          <button
                            className="text-xs text-text-muted hover:text-accent-light transition-colors flex items-center gap-1"
                            onClick={() => handleNewTodoClick(msg.id)}
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2Z" />
                            </svg>
                            Todo
                          </button>
                        </div>
                      )}

                      {/* Inline todo form */}
                      {newTodoMessageId === msg.id && (
                        <div className="mt-2 p-3 rounded-lg bg-surface-3 border border-glass-border animate-fade-in">
                          {todoError && (
                            <p className="text-xs text-danger mb-2">{todoError}</p>
                          )}
                          <div className="flex gap-2">
                            <Input
                              value={newTodoTitle}
                              onChange={(e) => setNewTodoTitle(e.target.value)}
                              placeholder="Todo 标题..."
                              className="!text-xs !py-1.5"
                              disabled={todoCreating}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleCreateTodo(msg.id);
                              }}
                            />
                            <Button size="sm" onClick={() => handleCreateTodo(msg.id)} loading={todoCreating} disabled={!newTodoTitle.trim()}>
                              添加
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleCancelTodo} disabled={todoCreating}>
                              取消
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* ── Stream Event Status Card ── */}
              {!replayMode && renderedEvents.length > 0 && (
                <div className="flex justify-start animate-fade-in">
                  <div className="max-w-[85%] min-w-[60%] bg-surface-2/80 border border-glass-border rounded-2xl rounded-bl-md overflow-hidden">
                    {/* Card header */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-glass-border bg-surface-3/50">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
                        <span className="text-xs font-medium text-accent-light">
                          实时处理中…
                        </span>
                      </div>
                      <button
                        className="text-xs text-text-muted hover:text-text-primary transition-colors"
                        onClick={() => setStreamCollapsed((v) => !v)}
                      >
                        {streamCollapsed ? "展开" : "收起"}
                      </button>
                    </div>

                    {/* Card body */}
                    {!streamCollapsed && (
                      <div
                        ref={streamListRef}
                        className="px-4 py-2 max-h-[280px] overflow-y-auto flex flex-col gap-1"
                      >
                        {renderedEvents.map((re) => (
                          <div key={re.id} className="flex items-start gap-2 py-0.5">
                            <span
                              className={`shrink-0 text-sm leading-5 ${re.spinning ? "animate-spin inline-block" : ""}`}
                              style={re.spinning ? { animationDuration: "2s" } : undefined}
                            >
                              {re.icon}
                            </span>
                            <span className={`text-xs leading-5 break-all ${re.color}`}>
                              {re.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </GlassCard>

      {/* Todo List */}
      {!replayMode && todos.length > 0 && (
        <GlassCard className="shrink-0 mb-4 !p-4 max-h-[180px] overflow-y-auto">
          <h3 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-accent">
              <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0Z" />
            </svg>
            待办 ({todos.filter((t) => t.status === "pending").length} 项未完成)
          </h3>
          <div className="flex flex-col gap-1.5">
            {todos.map((todo) => (
              <div key={todo.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-glass-border last:border-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Badge variant={todo.status === "done" ? "success" : "warning"}>
                    {todo.status === "done" ? "完成" : "待办"}
                  </Badge>
                  <span
                    className={`text-sm truncate ${todo.status === "done" ? "line-through text-text-muted" : "text-text-primary"}`}
                  >
                    {todo.title}
                  </span>
                </div>
                <Button
                  variant={todo.status === "pending" ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => handleToggleTodoStatus(todo)}
                  className="!text-xs !py-1 !px-2 shrink-0"
                >
                  {todo.status === "pending" ? "完成" : "重开"}
                </Button>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Message Input */}
      {!replayMode && (
        <GlassCard className="shrink-0 !p-3 sm:!p-4 w-full">
          <form onSubmit={handleSend} className="w-full">
            {sendError && (
              <div className="px-3 py-2 rounded-md bg-danger-muted border border-danger/30 text-sm text-danger mb-3">
                {sendError}
              </div>
            )}
            <div className="flex gap-2 w-full">
              <Input
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="输入消息..."
                className="flex-1 min-w-0"
                disabled={sending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e);
                  }
                }}
              />
              <Button type="submit" loading={sending} disabled={!content.trim()}>
                发送
              </Button>
            </div>
          </form>
        </GlassCard>
      )}
    </PageShell>
  );
}
