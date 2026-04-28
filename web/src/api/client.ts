const BASE_URL = "/api/v1";

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
  team_id: string;
  created_at: string;
}

export interface ProjectsResponse {
  data: Project[];
}

export interface CreateProjectRequest {
  name: string;
  description: string;
}

export interface CreateProjectResponse {
  data: Project;
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

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { code?: string }).code ?? `HTTP ${res.status}`,
    );
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

export function createProject(
  token: string,
  teamId: string,
  name: string,
  description: string,
): Promise<CreateProjectResponse> {
  return request<CreateProjectResponse>(`/teams/${teamId}/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, description }),
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
  session_id: string;
  created_at: string;
}

export interface MessagesResponse {
  data: Message[];
}

export interface SendMessageResponse {
  data: Message;
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

export interface ReplayResponse {
  data: Message[];
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

export type TodoStatus = "pending" | "done";

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