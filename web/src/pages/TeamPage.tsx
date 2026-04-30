import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  addTeamMember,
  clearAuthSession,
  createProject,
  getAgentNode,
  getProjects,
  getStoredAuthToken,
  getTeam,
  getTeamMembers,
  hasStoredAuthSession,
  upsertAgentNode,
  type AgentNode,
  type TeamMember,
} from "../api/client.js";
import { PageShell, GlassCard, Button, Input, Badge, PageLoading } from "../components/index.js";

interface TeamDetail {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  team_id: string;
  created_at: string;
}

function formatConnectionStatus(status: string) {
  switch (status) {
    case "online":
      return "在线";
    case "offline":
      return "离线";
    case "idle":
      return "空闲";
    default:
      return status;
  }
}

export function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Agent node state
  const [agentNode, setAgentNode] = useState<AgentNode | null>(null);
  const [agentNodeLoading, setAgentNodeLoading] = useState(false);
  const [agentNodeError, setAgentNodeError] = useState<string | null>(null);
  const [showAgentNodeForm, setShowAgentNodeForm] = useState(false);
  const [nodeDisplayName, setNodeDisplayName] = useState("");
  const [nodeConfiguring, setNodeConfiguring] = useState(false);

  // Members list state
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Invite member state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [projectWorkDir, setProjectWorkDir] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const token = getStoredAuthToken();

  useEffect(() => {
    if (!token && !hasStoredAuthSession()) { navigate("/login"); return; }
    if (!teamId) { navigate("/dashboard"); return; }
    loadTeamData();
  }, [teamId, token, navigate]);

  const loadTeamData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [teamRes, projectsRes] = await Promise.all([
        getTeam(token!, teamId!),
        getProjects(token!, teamId!),
      ]);
      setTeam(teamRes.data);
      setProjects(projectsRes.data);

      // Load members
      try {
        setMembersLoading(true);
        const membersRes = await getTeamMembers(token!, teamId!);
        setMembers(membersRes.data);
      } catch {
        // members list is best-effort
      } finally {
        setMembersLoading(false);
      }

      // Load agent node (best effort, 404 is expected)
      try {
        const nodeRes = await getAgentNode(token!, teamId!);
        setAgentNode(nodeRes.data);
      } catch (e: any) {
        if (e.message?.includes("NODE_NOT_CONFIGURED") || e.message?.includes("404")) {
          setAgentNode(null);
        }
      }
    } catch (err: any) {
      if (err.message === "UNAUTHORIZED" || err.message.includes("401")) {
        clearAuthSession(); navigate("/login"); return;
      }
      setError(err.message || "加载团队数据失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      setCreateError("项目名称不能为空");
      return;
    }
    try {
      setCreating(true);
      setCreateError(null);
      await createProject(token!, teamId!, projectName.trim(), projectDesc.trim(), projectWorkDir.trim());
      setProjectName("");
      setProjectDesc("");
      setProjectWorkDir("");
      setShowCreateForm(false);
      const projectsRes = await getProjects(token!, teamId!);
      setProjects(projectsRes.data);
    } catch (err: any) {
      setCreateError(err.message || "创建项目失败");
    } finally {
      setCreating(false);
    }
  };

  const handleConfigureAgentNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nodeDisplayName.trim()) {
      setAgentNodeError("节点名称不能为空");
      return;
    }
    try {
      setNodeConfiguring(true);
      setAgentNodeError(null);
      const fingerprint = "syncai-web-" + Date.now();
      const res = await upsertAgentNode(token!, teamId!, nodeDisplayName.trim(), fingerprint);
      setAgentNode(res.data);
      setNodeDisplayName("");
      setShowAgentNodeForm(false);
    } catch (err: any) {
      setAgentNodeError(err.message || "配置助手节点失败");
    } finally {
      setNodeConfiguring(false);
    }
  };

  const loadMembers = async () => {
    try {
      setMembersLoading(true);
      const membersRes = await getTeamMembers(token!, teamId!);
      setMembers(membersRes.data);
    } catch {
      // ignore
    } finally {
      setMembersLoading(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      setInviteError("请输入邮箱");
      return;
    }
    try {
      setInviting(true);
      setInviteError(null);
      setInviteSuccess(null);
      await addTeamMember(token!, teamId!, inviteEmail.trim(), inviteRole);
      setInviteSuccess(`已成功邀请 ${inviteEmail.trim()}（角色：${inviteRole === "admin" ? "管理员" : "成员"}）`);
      setInviteEmail("");
      setInviteRole("member");
      // Refresh member list
      loadMembers();
    } catch (err: any) {
      setInviteError(err.message || "邀请失败");
    } finally {
      setInviting(false);
    }
  };

  if (loading) return <PageLoading label="加载团队中..." />;

  if (error) {
    return (
      <PageShell title="错误" backTo={{ label: "返回仪表盘", href: "/dashboard" }}>
        <GlassCard>
          <p className="text-danger">{error}</p>
        </GlassCard>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={team?.name ?? "团队"}
      backTo={{ label: "返回仪表盘", href: "/dashboard" }}
    >
      {/* Team Info */}
      <GlassCard className="mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-text-primary">{team?.name}</h2>
          {team && <Badge variant="default">@{team.slug}</Badge>}
        </div>
        {team && (
          <p className="text-sm text-text-muted mt-2">
            创建于 {new Date(team.created_at).toLocaleDateString()}
          </p>
        )}

        {/* Agent Node Status */}
        <div className="mt-4 pt-4 border-t border-glass-border">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-text-primary">助手节点</h4>
              {agentNode ? (
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      agentNode.connection_status === "online"
                        ? "bg-green-400"
                        : "bg-yellow-400"
                    }`}
                  />
                  <span className="text-sm text-text-secondary">
                    {agentNode.display_name}
                    {" · "}
                    {formatConnectionStatus(agentNode.connection_status)}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-danger mt-1">未配置</p>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowAgentNodeForm(!showAgentNodeForm)}
            >
              {showAgentNodeForm ? "取消" : agentNode ? "重新配置" : "配置节点"}
            </Button>
          </div>

          {showAgentNodeForm && (
            <form onSubmit={handleConfigureAgentNode} className="mt-3 animate-fade-in">
              {agentNodeError && (
                <div className="px-3 py-2 rounded-md bg-danger-muted border border-danger/30 text-sm text-danger mb-3">
                  {agentNodeError}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  value={nodeDisplayName}
                  onChange={(e) => setNodeDisplayName(e.target.value)}
                  placeholder="节点名称（如：我的电脑）"
                  className="flex-1"
                  required
                />
                <Button type="submit" loading={nodeConfiguring} className="shrink-0">
                  注册节点
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Team Members List */}
        <div className="mt-4 pt-4 border-t border-glass-border">
          <h4 className="text-sm font-semibold text-text-primary mb-3">团队成员</h4>
          {membersLoading ? (
            <p className="text-xs text-text-muted">加载中...</p>
          ) : members.length === 0 ? (
            <p className="text-xs text-text-muted">暂无成员</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => (
                (() => {
                  const memberLabel = m.display_name || m.email;
                  const memberInitial = memberLabel.charAt(0).toUpperCase() || "?";

                  return (
                <li
                  key={m.user_id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-2 border border-glass-border"
                >
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-glass-border flex items-center justify-center text-xs text-text-secondary font-medium">
                    {memberInitial}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-text-primary truncate block">
                      {memberLabel}
                    </span>
                    {m.display_name && (
                      <span className="text-xs text-text-muted truncate block">
                        {m.email}
                      </span>
                    )}
                  </div>
                  <span
                    className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                      m.is_creator
                        ? "bg-accent/30 text-accent-light border border-accent/50"
                        : m.role === "admin"
                        ? "bg-accent/20 text-accent-light border border-accent/30"
                        : "bg-glass-border/40 text-text-muted border border-glass-border"
                    }`}
                  >
                    {m.is_creator ? "团长" : m.role === "admin" ? "管理员" : "成员"}
                  </span>
                </li>
                  );
                })()
              ))}
            </ul>
          )}
        </div>

        {/* Invite Member */}
        <div className="mt-4 pt-4 border-t border-glass-border">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-text-primary">邀请成员</h4>
              <p className="text-xs text-text-muted mt-0.5">
                添加队友到本团队，新成员将能访问团队内的项目和会话
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowInviteForm(!showInviteForm);
                setInviteError(null);
                setInviteSuccess(null);
              }}
            >
              {showInviteForm ? "取消" : "+ 邀请成员"}
            </Button>
          </div>

          {showInviteForm && (
            <form onSubmit={handleInviteMember} className="mt-3 animate-fade-in">
              {inviteError && (
                <div className="px-3 py-2 rounded-md bg-danger-muted border border-danger/30 text-sm text-danger mb-3">
                  {inviteError}
                </div>
              )}
              {inviteSuccess && (
                <div className="px-3 py-2 rounded-md bg-success-muted border border-success/30 text-sm text-success mb-3">
                  {inviteSuccess}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="输入队友邮箱..."
                  className="flex-1"
                  required
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                  className="px-3.5 py-2.5 rounded-input bg-surface-2 border border-glass-border text-text-primary text-sm transition-all duration-200 focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 shrink-0"
                  style={{ minWidth: 120 }}
                >
                  <option value="member">成员</option>
                  <option value="admin">管理员</option>
                </select>
                <Button type="submit" loading={inviting} className="shrink-0">
                  发送邀请
                </Button>
              </div>
            </form>
          )}
        </div>
      </GlassCard>

      {/* Projects */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-text-primary">项目列表</h3>
          <Button
            variant={showCreateForm ? "secondary" : "primary"}
            size="sm"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? "取消" : "+ 创建项目"}
          </Button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreateProject} className="mb-4 animate-fade-in">
            <GlassCard className="!bg-surface-2">
              {createError && (
                <div className="px-3 py-2 rounded-md bg-danger-muted border border-danger/30 text-sm text-danger mb-3">
                  {createError}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="项目名称"
                  className="flex-1"
                  required
                />
                <Input
                  value={projectDesc}
                  onChange={(e) => setProjectDesc(e.target.value)}
                  placeholder="项目描述（可选）"
                  className="flex-1"
                />
                <Input
                  value={projectWorkDir}
                  onChange={(e) => setProjectWorkDir(e.target.value)}
                  placeholder="工作目录（可选，如 C:\projects\my-app）"
                  className="flex-1"
                />
                <Button type="submit" loading={creating} className="shrink-0">
                  创建项目
                </Button>
              </div>
            </GlassCard>
          </form>
        )}

        {projects.length === 0 ? (
          <p className="text-sm text-text-muted py-4">还没有项目，点击上方按钮创建一个。</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                state={{
                  backTo: {
                    label: "返回团队",
                    href: `/teams/${teamId}`,
                  },
                }}
                className="block"
              >
                <div className="p-4 rounded-lg bg-surface-2 border border-glass-border hover:border-accent/30 hover:bg-glass-hover transition-all duration-200 group">
                  <h4 className="font-semibold text-text-primary group-hover:text-accent-light transition-colors">
                    {project.name}
                  </h4>
                  {project.description && (
                    <p className="text-sm text-text-secondary mt-1 truncate">{project.description}</p>
                  )}
                  <p className="text-xs text-text-muted mt-2">
                    {new Date(project.created_at).toLocaleDateString()}
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
