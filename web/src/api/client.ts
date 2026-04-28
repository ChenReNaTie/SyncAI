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