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