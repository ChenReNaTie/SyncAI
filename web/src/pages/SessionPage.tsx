import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  getSessionDetail,
  getMessages,
  sendMessage,
} from "../api/client.js";
import type { SessionDetail, Message } from "../api/client.js";

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
  }, [sessionId, token, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    <main className="page-shell" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header className="page-header">
        <Link to={projectLink}>&larr; Back to Project</Link>
      </header>

      <section className="content-section">
        <h2>
          {session?.title ?? "Session"}
          {session?.runtime_status && (
            <small style={{ marginLeft: "12px", color: "#666" }}>
              [{session.runtime_status}]
            </small>
          )}
        </h2>
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
        {loading && messages.length === 0 ? (
          <p>Loading messages...</p>
        ) : messages.length === 0 ? (
          <p>No messages yet. Start the conversation!</p>
        ) : (
          <div>
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <strong>{msg.sender}</strong>
                  <small style={{ color: "#888" }}>
                    {new Date(msg.created_at).toLocaleString()}
                  </small>
                </div>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.content}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </section>

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
    </main>
  );
}
