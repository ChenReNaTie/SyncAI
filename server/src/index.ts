import { buildApp } from "./app.js";

async function start() {
  const { app, env } = await buildApp();

  try {
    await app.listen({
      host: env.host,
      port: env.port,
    });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

void start();

