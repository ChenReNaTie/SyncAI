import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import {
  clearAuthSession,
  createSession,
  getProject,
  getSessions,
  getStoredAuthToken,
  hasStoredAuthSession,
  type Project,
} from "../api/client.js";
import { PageShell, GlassCard, Button, Input, Badge, PageLoading } from "../components/index.js";

interface Session {
  id: string;
  title: string;
  visibility: "shared" | "private";
  project_id: string;
  created_at: string;
  updated_at: string;
}

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

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibilityFilter, setVisibilityFilter] = useState<string>("");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionVisibility, setSessionVisibility] = useState<"shared" | "private">("shared");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const token = getStoredAuthToken();
  const locationState = location.state as PageLocationState | null;
  const projectBackTo = locationState?.backTo ?? {
    label: "返回仪表盘",
    href: "/dashboard",
  };

  useEffect(() => {
    if (!token && !hasStoredAuthSession()) { navigate("/login"); return; }
    if (!projectId) { navigate("/dashboard"); return; }
    loadProjectPage();
  }, [projectId, token, navigate, visibilityFilter]);

  const loadProjectPage = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = visibilityFilter
        ? { visibility: visibilityFilter as "shared" | "private" }
        : undefined;
      const [projectRes, sessionsRes] = await Promise.all([
        getProject(token!, projectId!),
        getSessions(token!, projectId!, params),
      ]);
      setProject(projectRes.data);
      setSessions(sessionsRes.data);
    } catch (err: any) {
      if (err.message === "UNAUTHORIZED" || err.message.includes("401")) {
        clearAuthSession(); navigate("/login"); return;
      }
      setError(err.message || "加载会话列表失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionTitle.trim()) {
      setCreateError("会话标题不能为空");
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
      setCreateError(err.message || "创建会话失败");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <PageLoading label="加载会话列表中..." />;

  if (error) {
    return (
      <PageShell title="错误" backTo={projectBackTo}>
        <GlassCard>
          <p className="text-danger">{error}</p>
        </GlassCard>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={project?.name ?? "项目"}
      backTo={projectBackTo}
    >
      <GlassCard className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-text-primary">
              {project?.name ?? "项目"}
            </h2>
            {project?.description ? (
              <p className="mt-2 text-sm text-text-secondary">
                {project.description}
              </p>
            ) : (
              <p className="mt-2 text-sm text-text-muted">
                暂未填写项目描述
              </p>
            )}
          </div>
          {project && (
            <Badge variant="default">
              创建于 {new Date(project.created_at).toLocaleDateString()}
            </Badge>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-glass-border bg-surface-2 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">
            工作目录
          </p>
          <p className="mt-2 text-sm text-text-secondary break-all">
            {project?.working_directory || "未配置工作目录"}
          </p>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-text-primary">全部会话</h3>
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
              <Link
                key={session.id}
                to={`/sessions/${session.id}`}
                state={{
                  backTo: {
                    label: "返回会话列表",
                    href: `/projects/${projectId}`,
                    state: {
                      backTo: projectBackTo,
                    },
                  },
                }}
                className="block"
              >
                <div className="p-4 rounded-lg bg-surface-2 border border-glass-border hover:border-accent/30 hover:bg-glass-hover transition-all duration-200 group">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-text-primary group-hover:text-accent-light transition-colors">
                      {session.title}
                    </h4>
                    <Badge variant={session.visibility === "shared" ? "success" : "default"}>
                      {session.visibility === "shared" ? "共享" : "私有"}
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
