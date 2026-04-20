import cors from "@fastify/cors";
import Fastify from "fastify";
import type { Pool } from "pg";
import { loadEnv } from "./config/env.js";
import { createDatabasePool } from "./lib/database.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";

export async function buildApp() {
  const env = loadEnv();
  const db = createDatabasePool(env.databaseUrl);
  const app = Fastify({
    logger: {
      level: env.nodeEnv === "development" ? "info" : "warn",
    },
  });

  app.decorate("config", {
    appName: env.appName,
    databaseUrl: env.databaseUrl,
    redisUrl: env.redisUrl,
  });
  app.decorate("db", db);

  await app.register(cors, {
    origin: true,
  });

  app.addHook("onClose", async () => {
    await db.end();
  });

  await app.register(async (api) => {
    await registerHealthRoutes(api);
    await registerWorkspaceRoutes(api);
  }, { prefix: "/api/v1" });

  return { app, env };
}

declare module "fastify" {
  interface FastifyInstance {
    config: {
      appName: string;
      databaseUrl: string;
      redisUrl: string;
    };
    db: Pool;
  }
}
