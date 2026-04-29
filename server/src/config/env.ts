import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SYNCAI_APP_NAME: z.string().default("SyncAI"),
  SYNCAI_SERVER_HOST: z.string().default("0.0.0.0"),
  SYNCAI_SERVER_PORT: z.coerce.number().int().positive().default(3001),
  SYNCAI_DATABASE_URL: z
    .string()
    .default("postgres://syncai:syncai@127.0.0.1:5432/syncai"),
  SYNCAI_REDIS_URL: z.string().default("redis://127.0.0.1:6380"),
  SYNCAI_CODEX_PATH: z.string().min(1).optional(),
  SYNCAI_MOCK_AGENT_LATENCY_MS: z.coerce.number().int().min(0).default(25),
  SYNCAI_AUTH_ACCESS_SECRET: z.string().default("syncai-access-secret"),
  SYNCAI_AUTH_REFRESH_SECRET: z.string().default("syncai-refresh-secret"),
  SYNCAI_AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  SYNCAI_AUTH_REFRESH_TTL_SECONDS: z.coerce.number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
});

export interface AppEnv {
  nodeEnv: "development" | "test" | "production";
  appName: string;
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  codexPath?: string;
  mockAgentLatencyMs: number;
  authAccessSecret: string;
  authRefreshSecret: string;
  authAccessTtlSeconds: number;
  authRefreshTtlSeconds: number;
}

export function loadEnv(rawEnv: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.parse(rawEnv);

  return {
    nodeEnv: parsed.NODE_ENV,
    appName: parsed.SYNCAI_APP_NAME,
    host: parsed.SYNCAI_SERVER_HOST,
    port: parsed.SYNCAI_SERVER_PORT,
    databaseUrl: parsed.SYNCAI_DATABASE_URL,
    redisUrl: parsed.SYNCAI_REDIS_URL,
    ...(parsed.SYNCAI_CODEX_PATH
      ? { codexPath: parsed.SYNCAI_CODEX_PATH }
      : {}),
    mockAgentLatencyMs: parsed.SYNCAI_MOCK_AGENT_LATENCY_MS,
    authAccessSecret: parsed.SYNCAI_AUTH_ACCESS_SECRET,
    authRefreshSecret: parsed.SYNCAI_AUTH_REFRESH_SECRET,
    authAccessTtlSeconds: parsed.SYNCAI_AUTH_ACCESS_TTL_SECONDS,
    authRefreshTtlSeconds: parsed.SYNCAI_AUTH_REFRESH_TTL_SECONDS,
  };
}
