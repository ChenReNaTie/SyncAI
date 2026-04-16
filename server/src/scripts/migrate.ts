import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv } from "../config/env.js";

const { Client } = pg;

interface MigrationFile {
  version: string;
  filePath: string;
  checksum: string;
  sql: string;
}

function getMigrationsDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), "../../migrations");
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const migrationsDir = getMigrationsDir();
  const entries = await readdir(migrationsDir, { withFileTypes: true });

  const files = entries
    .filter((entry) => entry.isFile() && extname(entry.name) === ".sql")
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    files.map(async (fileName) => {
      const filePath = resolve(migrationsDir, fileName);
      const sql = await readFile(filePath, "utf8");

      return {
        version: fileName,
        filePath,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    }),
  );
}

async function ensureMigrationsTable(client: InstanceType<typeof Client>) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function main() {
  const env = loadEnv();
  const client = new Client({ connectionString: env.databaseUrl });
  const migrations = await loadMigrationFiles();

  await client.connect();

  try {
    await ensureMigrationsTable(client);

    for (const migration of migrations) {
      const existing = await client.query<{
        version: string;
        checksum: string;
      }>(
        "SELECT version, checksum FROM schema_migrations WHERE version = $1",
        [migration.version],
      );

      if (existing.rowCount && existing.rows[0]?.checksum !== migration.checksum) {
        throw new Error(
          `Migration checksum changed for ${migration.version}. Refuse to continue.`,
        );
      }

      if (existing.rowCount) {
        console.log(`skip ${migration.version}`);
        continue;
      }

      console.log(`apply ${migration.version}`);
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
        [migration.version, migration.checksum],
      );
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

void main();

