import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appModuleUrl = pathToFileURL(resolve(__dirname, "..", "..", "server", "dist", "app.js")).href;

function snapshotEnv() {
  return { ...process.env };
}

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, snapshot);
}

export async function withInjectedApp(callback, envOverrides = {}) {
  const previousEnv = snapshotEnv();

  try {
    Object.assign(process.env, envOverrides);
    const { buildApp } = await import(`${appModuleUrl}?ts=${Date.now()}`);
    const { app } = await buildApp();

    try {
      return await callback(app);
    } finally {
      await app.close();
    }
  } finally {
    restoreEnv(previousEnv);
  }
}
