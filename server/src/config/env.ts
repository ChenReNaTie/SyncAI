import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SYNCAI_APP_NAME: z.string().default("SyncAI"),
  SYNCAI_SERVER_HOST: z.string().default("0.0.0.0"),
  SYNCAI_SERVER_PORT: z.coerce.number().int().positive().default(3001),
  SYNCAI_DATABASE_URL: z
    .string()
    .default("postgres://syncai:syncai@127.0.0.1:5432/syncai"),
  SYNCAI_REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  SYNCAI_MOCK_AGENT_LATENCY_MS: z.coerce.number().int().min(0).default(25),
});

export interface AppEnv {
  nodeEnv: "development" | "test" | "production";
  appName: string;
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  mockAgentLatencyMs: number;
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
    mockAgentLatencyMs: parsed.SYNCAI_MOCK_AGENT_LATENCY_MS,
  };
}
