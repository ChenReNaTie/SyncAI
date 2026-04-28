import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getSessions, createSession } from "../api/client.js";

interface Session {
  id: string;
  title: string;
  visibility: "shared" | "private";
  project_id: string;
  created_at: string;
  updated_at: string;
}

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibilityFilter, setVisibilityFilter] = useState<string>("");

  // Create session form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionVisibility, setSessionVisibility] = useState<"shared" | "private">("shared");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    if (!projectId) {
      navigate("/dashboard");
      return;
    }
    loadSessions();
  }, [projectId, token, navigate, visibilityFilter]);

  const loadSessions = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = visibilityFilter
        ? { visibility: visibilityFilter as "shared" | "private" }
        : undefined;

      const res = await getSessions(token!, projectId!, params);
      setSessions(res.data);
    } catch (err: any) {
      if (err.message === "UNAUTHORIZED" || err.message.includes("401")) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setError(err.message || "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionTitle.trim()) {
      setCreateError("Session title is required");
      return;
    }

    try {
      setCreating(true);
      setCreateError(null);

      await createSession(token!, projectId!, sessionTitle.trim(), sessionVisibility);

      setSessionTitle("");
      setSessionVisibility("shared");
      setShowCreateForm(false);

      // Reload sessions
      const params = visibilityFilter
        ? { visibility: visibilityFilter as "shared" | "private" }
        : undefined;
      const res = await getSessions(token!, projectId!, params);
      setSessions(res.data);
    } catch (err: any) {
      setCreateError(err.message || "Failed to create session");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <main className="page-shell">
        <section className="hero">
          <h1>Loading Sessions...</h1>
        </section>
      </main>
    );
  }

  if (error) {
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

  return (
    <main className="page-shell">
      <header className="page-header">
        <Link to="/dashboard">&larr; Back to Dashboard</Link>
      </header>

      <section className="content-section">
        <h2>
          Sessions <small>(Project: {projectId})</small>
        </h2>
      </section>

      <section className="content-section">
        <div className="section-header">
          <h3>Sessions</h3>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <select
              value={visibilityFilter}
              onChange={(e) => setVisibilityFilter(e.target.value)}
              className="form-control"
              style={{ width: "auto" }}
            >
              <option value="">All</option>
              <option value="shared">Shared</option>
              <option value="private">Private</option>
            </select>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowCreateForm(!showCreateForm)}
            >
              {showCreateForm ? "Cancel" : "+ Create Session"}
            </button>
          </div>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreateSession} className="form">
            {createError && (
              <div className="alert alert-error">
                <p>{createError}</p>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="sessionTitle">Session Title</label>
              <input
                id="sessionTitle"
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                placeholder="Enter session title"
                className="form-control"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="sessionVisibility">Visibility</label>
              <select
                id="sessionVisibility"
                value={sessionVisibility}
                onChange={(e) =>
                  setSessionVisibility(e.target.value as "shared" | "private")
                }
                className="form-control"
              >
                <option value="shared">Shared</option>
                <option value="private">Private</option>
              </select>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating}
            >
              {creating ? "Creating..." : "Create Session"}
            </button>
          </form>
        )}

        {sessions.length === 0 ? (
          <p>No sessions yet.</p>
        ) : (
          <ul className="team-grid">
            {sessions.map((session) => (
              <li key={session.id} className="card">
                <h4><Link to={`/sessions/${session.id}`}>{session.title}</Link></h4>
                <p>
                  <strong>Visibility:</strong> {session.visibility}
                </p>
                <small>
                  Created: {new Date(session.created_at).toLocaleString()}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
