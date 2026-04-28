import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  getSessionDetail,
  getMessages,
  sendMessage,
  getReplay,
  getTodos,
  createTodo,
  updateTodoStatus,
} from "../api/client.js";
import type {
  SessionDetail,
  Message,
  Todo,
  TodoStatus,
} from "../api/client.js";

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Send message form state
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Replay state
  const [replayMode, setReplayMode] = useState(false);
  const [replayMessages, setReplayMessages] = useState<Message[]>([]);
  const [replayLoading, setReplayLoading] = useState(false);

  // Todo state
  const [todos, setTodos] = useState<Todo[]>([]);
  const [todosLoading, setTodosLoading] = useState(false);
  // Which message is having a todo created (its id), null means none
  const [newTodoMessageId, setNewTodoMessageId] = useState<string | null>(null);
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [todoCreating, setTodoCreating] = useState(false);
  const [todoError, setTodoError] = useState<string | null>(null);

  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    if (!sessionId) {
      navigate("/dashboard");
      return;
    }
    loadSession();
    loadMessages();
    loadTodos();
  }, [sessionId, token, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, replayMessages]);

  const loadSession = async () => {
    try {
      const res = await getSessionDetail(token!, sessionId!);
      setSession(res.data);
    } catch (err: any) {
      if (err.message === "UNAUTHORIZED" || err.message.includes("401")) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
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
        localStorage.removeItem("token");
        navigate("/login");
        return;
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
    } catch (err: any) {
      // silently ignore todo load errors in the UI
    } finally {
      setTodosLoading(false);
    }
  };

  // --- Replay ---

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;

    try {
      setSending(true);
      setSendError(null);
      const res = await sendMessage(token!, sessionId!, trimmed);
      setMessages((prev) => [...prev, res.data]);
      setContent("");
    } catch (err: any) {
      setSendError(err.message || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  // --- Replay ---

  const handleToggleReplay = async () => {
    if (replayMode) {
      setReplayMode(false);
      setReplayMessages([]);
      return;
    }
    try {
      setReplayLoading(true);
      const res = await getReplay(token!, sessionId!);
      // sort by created_at ascending
      const sorted = [...res.data].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      setReplayMessages(sorted);
      setReplayMode(true);
    } catch (err: any) {
      setError(err.message || "Failed to load replay");
    } finally {
      setReplayLoading(false);
    }
  };

  // --- Todo ---

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
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? res.data : t)),
      );
    } catch (err: any) {
      // silently ignore
    }
  };

  const displayMessages = replayMode ? replayMessages : messages;

  if (loading && !session) {
    return (
      <main className="page-shell">
        <section className="hero">
          <h1>Loading Session...</h1>
        </section>
      </main>
    );
  }

  if (error && !session) {
    return (
      <main className="page-shell">
        <header className="page-header">
          <Link to="/dashboard">&larr; Back to Dashboard</Link>
        </header>
        <section className="content-section">
          <div className="alert alert-error">
            <p>Error: {error}</p>
          </div>
        </section>
      </main>
    );
  }

  const projectLink = session?.project_id
    ? `/projects/${session.project_id}`
    : "/dashboard";

  return (
    <main
      className="page-shell"
      style={{ display: "flex", flexDirection: "column", height: "100vh" }}
    >
      <header className="page-header">
        <Link to={projectLink}>&larr; Back to Project</Link>
      </header>

      <section className="content-section">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <h2>
            {session?.title ?? "Session"}
            {session?.runtime_status && (
              <small style={{ marginLeft: "12px", color: "#666" }}>
                [{session.runtime_status}]
              </small>
            )}
            {replayMode && (
              <span style={{ marginLeft: "8px", color: "#e67e22" }}>
                [REPLAY]
              </span>
            )}
          </h2>
          <button
            className={replayMode ? "btn btn-outline" : "btn btn-secondary"}
            onClick={handleToggleReplay}
            disabled={replayLoading}
          >
            {replayLoading ? "Loading..." : replayMode ? "Exit Replay" : "Replay"}
          </button>
        </div>
      </section>

      <section
        className="content-section"
        style={{
          flex: 1,
          overflowY: "auto",
          maxHeight: "calc(100vh - 220px)",
          paddingBottom: "16px",
        }}
      >
        {loading && displayMessages.length === 0 ? (
          <p>Loading messages...</p>
        ) : displayMessages.length === 0 ? (
          <p>No messages yet. Start the conversation!</p>
        ) : (
          <div>
            {displayMessages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "4px",
                  }}
                >
                  <strong>{msg.sender}</strong>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {!replayMode && (
                      <button
                        className="btn btn-sm"
                        style={{
                          fontSize: "12px",
                          padding: "2px 8px",
                          background: "#f0f0f0",
                          border: "1px solid #ddd",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                        onClick={() => handleNewTodoClick(msg.id)}
                      >
                        + Todo
                      </button>
                    )}
                    <small style={{ color: "#888" }}>
                      {new Date(msg.created_at).toLocaleString()}
                    </small>
                  </div>
                </div>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {msg.content}
                </p>

                {/* Inline todo creation form */}
                {newTodoMessageId === msg.id && (
                  <div
                    style={{
                      marginTop: "8px",
                      padding: "8px",
                      background: "#fafafa",
                      borderRadius: "4px",
                      border: "1px solid #eee",
                    }}
                  >
                    {todoError && (
                      <div style={{ color: "red", marginBottom: "4px", fontSize: "13px" }}>
                        {todoError}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input
                        type="text"
                        value={newTodoTitle}
                        onChange={(e) => setNewTodoTitle(e.target.value)}
                        placeholder="Todo title..."
                        style={{ flex: 1 }}
                        className="form-control"
                        disabled={todoCreating}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreateTodo(msg.id);
                        }}
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleCreateTodo(msg.id)}
                        disabled={todoCreating || !newTodoTitle.trim()}
                        style={{ fontSize: "12px", padding: "2px 12px" }}
                      >
                        {todoCreating ? "..." : "Add"}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleCancelTodo}
                        disabled={todoCreating}
                        style={{ fontSize: "12px", padding: "2px 12px" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </section>

      {/* Todo list at the bottom */}
      {!replayMode && todos.length > 0 && (
        <section
          className="content-section"
          style={{
            borderTop: "1px solid #ddd",
            paddingTop: "12px",
            paddingBottom: "12px",
            maxHeight: "200px",
            overflowY: "auto",
          }}
        >
          <h3 style={{ margin: "0 0 8px 0", fontSize: "15px" }}>
            Todos ({todos.filter((t) => t.status === "pending").length} pending)
          </h3>
          {todos.map((todo) => (
            <div
              key={todo.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 0",
                borderBottom: "1px solid #f0f0f0",
                gap: "8px",
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    padding: "1px 6px",
                    borderRadius: "3px",
                    fontWeight: 600,
                    background: todo.status === "done" ? "#27ae60" : "#e67e22",
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  {todo.status}
                </span>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration:
                      todo.status === "done" ? "line-through" : "none",
                    color: todo.status === "done" ? "#999" : "inherit",
                  }}
                >
                  {todo.title}
                </span>
              </div>
              {todo.status === "pending" && (
                <button
                  className="btn btn-sm"
                  style={{
                    fontSize: "11px",
                    padding: "2px 10px",
                    background: "#27ae60",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                  onClick={() => handleToggleTodoStatus(todo)}
                >
                  Done
                </button>
              )}
              {todo.status === "done" && (
                <button
                  className="btn btn-sm"
                  style={{
                    fontSize: "11px",
                    padding: "2px 10px",
                    background: "#e67e22",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                  onClick={() => handleToggleTodoStatus(todo)}
                >
                  Reopen
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Message input form — hidden in replay mode */}
      {!replayMode && (
        <section
          className="content-section"
          style={{
            borderTop: "1px solid #ddd",
            paddingTop: "12px",
            paddingBottom: "12px",
          }}
        >
          <form onSubmit={handleSend}>
            {sendError && (
              <div className="alert alert-error">
                <p>{sendError}</p>
              </div>
            )}

            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Type a message..."
                className="form-control"
                style={{ flex: 1 }}
                disabled={sending}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={sending || !content.trim()}
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
