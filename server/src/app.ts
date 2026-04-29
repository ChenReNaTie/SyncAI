import cors from "@fastify/cors";
import Fastify from "fastify";
import type { Pool } from "pg";
import { loadEnv } from "./config/env.js";
import { createDatabasePool } from "./lib/database.js";
import {
  createWorkspaceRuntime,
  type WorkspaceRuntime,
} from "./lib/workspace-runtime.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerTeamRoutes } from "./routes/teams.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";
import { registerWsRoute } from "./routes/ws.js";

export async function buildApp() {
  const env = loadEnv();
  const db = createDatabasePool(env.databaseUrl);
  const app = Fastify({
    logger: {
      level: env.nodeEnv === "development" ? "info" : "warn",
    },
  });
  const workspaceRuntime = createWorkspaceRuntime({
    db,
    logger: app.log,
    ...(env.codexPath ? { codexPath: env.codexPath } : {}),
    mockLatencyMs: env.mockAgentLatencyMs,
  });

  app.decorate("config", {
    appName: env.appName,
    databaseUrl: env.databaseUrl,
    redisUrl: env.redisUrl,
    ...(env.codexPath ? { codexPath: env.codexPath } : {}),
    authAccessSecret: env.authAccessSecret,
    authRefreshSecret: env.authRefreshSecret,
    authAccessTtlSeconds: env.authAccessTtlSeconds,
    authRefreshTtlSeconds: env.authRefreshTtlSeconds,
  });
  app.decorate("db", db);
  app.decorate("workspaceRuntime", workspaceRuntime);

  await app.register(cors, {
    origin: true,
  });

  app.addHook("onClose", async () => {
    await workspaceRuntime.close();
    await db.end();
  });

  await app.register(async (api) => {
    await registerHealthRoutes(api);
    await registerAuthRoutes(api);
    await registerTeamRoutes(api);
    await registerWorkspaceRoutes(api);
  }, { prefix: "/api/v1" });

  // Register WebSocket upgrade handler after the server is ready.
  // Fastify 5 creates the underlying HTTP server during ready() / listen(),
  // so app.server may be null before that.
  app.addHook("onReady", async () => {
    registerWsRoute(app);
  });

  return { app, env };
}

declare module "fastify" {
  interface FastifyInstance {
    config: {
      appName: string;
      databaseUrl: string;
      redisUrl: string;
      codexPath?: string;
      authAccessSecret: string;
      authRefreshSecret: string;
      authAccessTtlSeconds: number;
      authRefreshTtlSeconds: number;
    };
    db: Pool;
    workspaceRuntime: WorkspaceRuntime;
  }
}
