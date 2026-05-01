const BASE_URL = "/api/v1";
const ACCESS_TOKEN_KEY = "token";
const REFRESH_TOKEN_KEY = "refresh_token";

const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: "请求参数有误，请检查输入",
  TEAM_NAME_EXISTS: "团队名称已存在",
  TEAM_SLUG_EXISTS: "团队标识已被占用",
  PROJECT_NAME_EXISTS: "项目名称已存在",
  AUTH_REQUIRED: "登录已过期，请重新登录",
  UNAUTHORIZED: "登录已过期，请重新登录",
  FORBIDDEN: "无权执行此操作",
  NOT_FOUND: "资源不存在",
  INTERNAL_ERROR: "服务器内部错误",
};

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
}

export interface TokenResponse {
  data: {
    user: AuthUser;
    access_token: string;
    refresh_token: string;
  };
}

interface RefreshTokenRequest {
  refresh_token: string;
}

export interface MeResponse {
  data: AuthUser;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface TeamsResponse {
  data: Team[];
}

export interface CreateTeamRequest {
  name: string;
  slug: string;
}

export interface CreateTeamResponse {
  data: Team;
}

export interface TeamDetail {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface TeamDetailResponse {
  data: TeamDetail;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  working_directory: string | null;
  team_id: string;
  created_at: string;
}

export interface ProjectsResponse {
  data: Project[];
}

export interface ProjectDetailResponse {
  data: Project;
}

export interface CreateProjectRequest {
  name: string;
  description: string;
  working_directory?: string;
}

export interface CreateProjectResponse {
  data: Project;
}

// --- Agent Node ---

export interface AgentNode {
  id: string;
  team_id: string;
  owner_user_id: string;
  agent_type: string;
  node_mode: string;
  display_name: string;
  connection_status: string;
  client_fingerprint: string | null;
  last_heartbeat_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentNodeResponse {
  data: AgentNode;
}

export interface UpsertAgentNodeRequest {
  display_name: string;
  client_fingerprint: string;
}

export interface Session {
  id: string;
  title: string;
  visibility: "shared" | "private";
  project_id: string;
  created_at: string;
  updated_at: string;
}

export interface SessionsResponse {
  data: Session[];
}

export interface CreateSessionRequest {
  title: string;
  visibility: "shared" | "private";
}

export interface CreateSessionResponse {
  data: Session;
}

export interface SessionsParams {
  visibility?: "shared" | "private";
  limit?: number;
  cursor?: string;
}

let refreshPromise: Promise<string | null> | null = null;

export function getStoredAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getStoredRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredAuthToken() {
  return getStoredAccessToken() ?? getStoredRefreshToken();
}

export function hasStoredAuthSession() {
  return Boolean(getStoredAccessToken() || getStoredRefreshToken());
}

export function storeAuthSession(tokens: {
  accessToken: string;
  refreshToken: string;
}) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearAuthSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function buildHeaders(headers?: HeadersInit) {
  const merged = new Headers({
    "Content-Type": "application/json",
  });

  if (headers) {
    const incoming = new Headers(headers);
    incoming.forEach((value, key) => {
      merged.set(key, value);
    });
  }

  return merged;
}

function getBearerToken(headers: Headers) {
  const authorization = headers.get("Authorization");
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function cloneRequestOptions(options: RequestInit, headers: Headers): RequestInit {
  return {
    ...options,
    headers,
  };
}

export async function refreshAccessToken() {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    clearAuthSession();
    return null;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      } satisfies RefreshTokenRequest),
    });

    if (!res.ok) {
      clearAuthSession();
      return null;
    }

    const payload = await res.json() as TokenResponse;
    storeAuthSession({
      accessToken: payload.data.access_token,
      refreshToken: payload.data.refresh_token,
    });

    return payload.data.access_token;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  allowRefresh = true,
): Promise<T> {
  const headers = buildHeaders(options.headers);
  const res = await fetch(`${BASE_URL}${path}`, {
    ...cloneRequestOptions(options, headers),
  });

  if (!res.ok) {
    const bearerToken = getBearerToken(headers);
    if (
      res.status === 401
      && allowRefresh
      && bearerToken
      && !["/auth/login", "/auth/register", "/auth/refresh"].includes(path)
    ) {
      const nextAccessToken = await refreshAccessToken();
      if (nextAccessToken) {
        headers.set("Authorization", `Bearer ${nextAccessToken}`);
        return request<T>(path, cloneRequestOptions(options, headers), false);
      }
    }

    const body = await res.json().catch(() => ({}));
    const code = (body as { code?: string }).code ?? `HTTP ${res.status}`;
    let message = ERROR_MESSAGES[code] || code;
    const detail = (body as { message?: string }).message || (body as { error?: string }).error;
    if (code === "INVALID_REQUEST") {
      const details = (body as { details?: Record<string, unknown> }).details;
      if (details) {
        const flattened = Object.entries(details)
          .flatMap(([key, val]) => {
            if (Array.isArray(val)) {
              return val.map((v) => `${key}：${typeof v === "string" ? v : JSON.stringify(v)}`);
            }
            return [`${key}：${String(val)}`];
          })
          .join("；");
        if (flattened) {
          message = `${message}：${flattened}`;
        }
      }
    } else if (detail && code === "VALIDATION_ERROR") {
      message = `${message}：${detail}`;
    } else if (detail && detail !== code) {
      message = `${message}（${detail}）`;
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export function register(
  email: string,
  password: string,
  displayName: string,
): Promise<TokenResponse> {
  return request<TokenResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      display_name: displayName,
    }),
  });
}

export function login(
  email: string,
  password: string,
): Promise<TokenResponse> {
  return request<TokenResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getMe(token: string): Promise<MeResponse> {
  return request<MeResponse>("/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getTeams(token: string): Promise<TeamsResponse> {
  return request<TeamsResponse>("/teams", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function createTeam(
  token: string,
  teamData: CreateTeamRequest
): Promise<CreateTeamResponse> {
  return request<CreateTeamResponse>("/teams", {
    method: "POST",
    headers: { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(teamData),
  });
}

export function getTeam(
  token: string,
  teamId: string,
): Promise<TeamDetailResponse> {
  return request<TeamDetailResponse>(`/teams/${teamId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getProjects(
  token: string,
  teamId: string,
): Promise<ProjectsResponse> {
  return request<ProjectsResponse>(`/teams/${teamId}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getProject(
  token: string,
  projectId: string,
): Promise<ProjectDetailResponse> {
  return request<ProjectDetailResponse>(`/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function createProject(
  token: string,
  teamId: string,
  name: string,
  description: string,
  workingDirectory?: string,
): Promise<CreateProjectResponse> {
  return request<CreateProjectResponse>(`/teams/${teamId}/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      description,
      ...(workingDirectory !== undefined && workingDirectory !== ""
        ? { working_directory: workingDirectory }
        : {}),
    }),
  });
}

export function getSessions(
  token: string,
  projectId: string,
  params?: SessionsParams,
): Promise<SessionsResponse> {
  const query = new URLSearchParams();
  if (params?.visibility) query.set("visibility", params.visibility);
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", params.cursor);
  const qs = query.toString();
  return request<SessionsResponse>(
    `/projects/${projectId}/sessions${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

export function createSession(
  token: string,
  projectId: string,
  title: string,
  visibility: "shared" | "private",
): Promise<CreateSessionResponse> {
  return request<CreateSessionResponse>(`/projects/${projectId}/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, visibility }),
  });
}

export interface SessionDetail {
  id: string;
  title: string;
  visibility: "shared" | "private";
  runtime_status: string;
  project_id: string;
  bound_agent_session_ref?: string;
  bound_agent_node_id?: string;
  created_at: string;
  updated_at: string;
}

export interface SessionDetailResponse {
  data: SessionDetail;
}

export interface Message {
  id: string;
  content: string;
  sender: string;
  sender_type?: "member" | "agent";
  sender_user_id?: string | null;
  sender_display_name?: string;
  session_id: string;
  processing_status?: string;
  is_final_reply?: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface MessagesResponse {
  data: Message[];
}

export interface SendMessageResponse {
  data: {
    message: Message;
    dispatch_state: {
      session_runtime_status: string;
      queue_position: number;
    };
  };
}

export function getSessionDetail(
  token: string,
  sessionId: string,
): Promise<SessionDetailResponse> {
  return request<SessionDetailResponse>(`/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getMessages(
  token: string,
  sessionId: string,
): Promise<MessagesResponse> {
  return request<MessagesResponse>(`/sessions/${sessionId}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function sendMessage(
  token: string,
  sessionId: string,
  content: string,
): Promise<SendMessageResponse> {
  return request<SendMessageResponse>(`/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
}

// --- Team Members ---

export interface AddTeamMember {
  team_id: string;
  user_id: string;
  role: "admin" | "member";
  joined_at: string;
  invited_by: string | null;
}

export interface AddTeamMemberResponse {
  data: AddTeamMember;
}

export interface TeamMember {
  user_id: string;
  email: string;
  display_name: string;
  role: "admin" | "member";
  is_creator?: boolean;
  joined_at: string;
}

export interface TeamMembersResponse {
  data: TeamMember[];
}

export function addTeamMember(
  token: string,
  teamId: string,
  email: string,
  role: "admin" | "member",
): Promise<AddTeamMemberResponse> {
  return request<AddTeamMemberResponse>(`/teams/${teamId}/members`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, role }),
  });
}

export function getTeamMembers(
  token: string,
  teamId: string,
): Promise<TeamMembersResponse> {
  return request<TeamMembersResponse>(`/teams/${teamId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface SearchMessageItem {
  message_id: string;
  content: string;
  sender: string;
  session_id: string;
  session_title: string;
  project_id: string;
  project_name: string;
  created_at: string;
}

export interface SearchMeta {
  query: string;
  team_id: string;
  total: number;
  next_cursor: string | null;
}

export interface SearchMessagesResponse {
  data: SearchMessageItem[];
  meta: SearchMeta;
}

export function searchMessages(
  token: string,
  teamId: string,
  query: string,
): Promise<SearchMessagesResponse> {
  const qs = new URLSearchParams({ q: query });
  return request<SearchMessagesResponse>(
    `/teams/${teamId}/search?${qs.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

// --- Replay ---

export interface ReplayMessageEntry {
  entry_type: "message";
  message_id: string;
  occurred_at: string;
  sender_type: "member" | "agent";
  content: string;
}

export interface ReplayStatusChangedEntry {
  entry_type: "status_changed";
  occurred_at: string;
  from: string | null;
  to: string | null;
  summary: string;
}

export interface ReplayCommandSummaryEntry {
  entry_type: "command_summary";
  occurred_at: string;
  summary: string;
}

export interface ReplayVisibilityChangedEntry {
  entry_type: "visibility_changed";
  occurred_at: string;
  from: string | null;
  to: string | null;
  summary: string;
}

export type ReplayEntry =
  | ReplayMessageEntry
  | ReplayStatusChangedEntry
  | ReplayCommandSummaryEntry
  | ReplayVisibilityChangedEntry;

export interface ReplayResponse {
  data: ReplayEntry[];
}

export function getReplay(
  token: string,
  sessionId: string,
): Promise<ReplayResponse> {
  return request<ReplayResponse>(`/sessions/${sessionId}/replay`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// --- Todos ---

export type TodoStatus = "pending" | "completed";

export interface Todo {
  id: string;
  session_id: string;
  source_message_id: string;
  title: string;
  status: TodoStatus;
  created_at: string;
  updated_at: string;
}

export interface TodosResponse {
  data: Todo[];
}

export interface CreateTodoResponse {
  data: Todo;
}

export interface UpdateTodoStatusResponse {
  data: Todo;
}

export function getTodos(
  token: string,
  sessionId: string,
): Promise<TodosResponse> {
  return request<TodosResponse>(`/sessions/${sessionId}/todos`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function createTodo(
  token: string,
  sessionId: string,
  sourceMessageId: string,
  title: string,
): Promise<CreateTodoResponse> {
  return request<CreateTodoResponse>(`/sessions/${sessionId}/todos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_message_id: sourceMessageId,
      title,
    }),
  });
}

export function updateTodoStatus(
  token: string,
  todoId: string,
  status: TodoStatus,
): Promise<UpdateTodoStatusResponse> {
  return request<UpdateTodoStatusResponse>(`/todos/${todoId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
}

// --- Agent Node ---

export function getAgentNode(
  token: string,
  teamId: string,
): Promise<AgentNodeResponse> {
  return request<AgentNodeResponse>(`/teams/${teamId}/agent-node`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function upsertAgentNode(
  token: string,
  teamId: string,
  displayName: string,
  clientFingerprint: string,
): Promise<AgentNodeResponse> {
  return request<AgentNodeResponse>(`/teams/${teamId}/agent-node`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      display_name: displayName,
      client_fingerprint: clientFingerprint,
    }),
  });
}
