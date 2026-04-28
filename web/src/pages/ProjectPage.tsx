import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getSessions, createSession } from "../api/client.js";
import { PageShell, GlassCard, Button, Input, Badge, PageLoading } from "../components/index.js";

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

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionVisibility, setSessionVisibility] = useState<"shared" | "private">("shared");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token) { navigate("/login"); return; }
    if (!projectId) { navigate("/dashboard"); return; }
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
        localStorage.removeItem("token"); navigate("/login"); return;
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

  if (loading) return <PageLoading label="Loading sessions..." />;

  if (error) {
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
      title="会话列表"
      backTo={{ label: "返回 Dashboard", href: "/dashboard" }}
    >
      <GlassCard>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-text-primary">所有会话</h3>
            <select
              value={visibilityFilter}
              onChange={(e) => setVisibilityFilter(e.target.value)}
              className="px-3 py-1.5 rounded-md bg-surface-2 border border-glass-border text-text-primary text-xs focus:outline-none focus:border-accent/50"
            >
              <option value="">全部</option>
              <option value="shared">共享</option>
              <option value="private">私有</option>
            </select>
          </div>
          <Button
            variant={showCreateForm ? "secondary" : "primary"}
            size="sm"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? "取消" : "+ 创建会话"}
          </Button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreateSession} className="mb-4 animate-fade-in">
            <div className="p-4 rounded-lg bg-surface-2 border border-glass-border">
              {createError && (
                <div className="px-3 py-2 rounded-md bg-danger-muted border border-danger/30 text-sm text-danger mb-3">
                  {createError}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  value={sessionTitle}
                  onChange={(e) => setSessionTitle(e.target.value)}
                  placeholder="会话标题"
                  className="flex-1"
                  required
                />
                <select
                  value={sessionVisibility}
                  onChange={(e) => setSessionVisibility(e.target.value as "shared" | "private")}
                  className="w-full sm:w-32 px-3.5 py-2.5 rounded-button bg-surface-2 border border-glass-border text-text-primary text-sm focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                >
                  <option value="shared">共享</option>
                  <option value="private">私有</option>
                </select>
                <Button type="submit" loading={creating} className="shrink-0">
                  创建会话
                </Button>
              </div>
            </div>
          </form>
        )}

        {sessions.length === 0 ? (
          <p className="text-sm text-text-muted py-4">还没有会话，点击上方按钮创建一个。</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {sessions.map((session) => (
              <Link key={session.id} to={`/sessions/${session.id}`} className="block">
                <div className="p-4 rounded-lg bg-surface-2 border border-glass-border hover:border-accent/30 hover:bg-glass-hover transition-all duration-200 group">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-text-primary group-hover:text-accent-light transition-colors">
                      {session.title}
                    </h4>
                    <Badge variant={session.visibility === "shared" ? "success" : "default"}>
                      {session.visibility}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    {new Date(session.created_at).toLocaleString()}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </GlassCard>
    </PageShell>
  );
}
