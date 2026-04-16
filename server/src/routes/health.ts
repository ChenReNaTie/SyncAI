import type { FastifyInstance } from "fastify";
import { AGENT_TYPE, type AppHealth } from "@syncai/shared";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (): Promise<AppHealth> => ({
    name: app.config.appName,
    version: "0.1.0",
    agentType: AGENT_TYPE,
    stage: "phase-0",
    runtime: {
      node: process.version,
      timestamp: new Date().toISOString(),
    },
  }));
}

