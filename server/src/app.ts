import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadEnv } from "./config/env.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMvpPlaceholderRoutes } from "./routes/mvp-placeholders.js";

export async function buildApp() {
  const env = loadEnv();
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

  await app.register(cors, {
    origin: true,
  });

  await app.register(async (api) => {
    await registerHealthRoutes(api);
    await registerMvpPlaceholderRoutes(api);
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
  }
}
