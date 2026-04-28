import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const defaultDatabaseUrl = "postgres://syncai:syncai@127.0.0.1:5432/syncai";

let pool;

export function getDatabaseUrl() {
  return process.env.SYNCAI_DATABASE_URL ?? defaultDatabaseUrl;
}

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
    });
  }

  return pool;
}

export async function closePool() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = undefined;
}

function uniqueValue(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export async function listEnumValues(client, enumName) {
  assert.match(enumName, /^[a-z_]+$/);

  const result = await client.query(
    `SELECT unnest(enum_range(NULL::${enumName}))::text AS value`,
  );

  return result.rows.map((row) => row.value);
}

export async function seedSessionContext(client, overrides = {}) {
  const ownerEmail = `${uniqueValue("owner")}@example.com`;
  const memberEmail = `${uniqueValue("member")}@example.com`;

  const {
    rows: [owner],
  } = await client.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [ownerEmail, "hash", "Owner"],
  );

  const {
    rows: [member],
  } = await client.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [memberEmail, "hash", "Member"],
  );

  const {
    rows: [team],
  } = await client.query(
    `INSERT INTO teams (name, slug, created_by)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [uniqueValue("Team"), uniqueValue("team"), owner.id],
  );

  await client.query(
    `INSERT INTO team_members (team_id, user_id, role, invited_by)
     VALUES ($1, $2, 'admin', $2), ($1, $3, 'member', $2)`,
    [team.id, owner.id, member.id],
  );

  const {
    rows: [node],
  } = await client.query(
    `INSERT INTO team_agent_nodes (
       team_id,
       owner_user_id,
       display_name,
       connection_status,
       metadata
     )
     VALUES ($1, $2, $3, 'online', '{}'::jsonb)
     RETURNING id`,
    [team.id, owner.id, uniqueValue("node")],
  );

  const {
    rows: [project],
  } = await client.query(
    `INSERT INTO projects (team_id, name, created_by)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [team.id, uniqueValue("Project"), owner.id],
  );

  const sessionPayload = {
    title: overrides.title ?? uniqueValue("session"),
    visibility: overrides.visibility ?? "shared",
    runtimeStatus: overrides.runtimeStatus ?? "idle",
    boundAgentSessionRef:
      overrides.boundAgentSessionRef ?? uniqueValue("bound-session"),
  };

  const {
    rows: [session],
  } = await client.query(
    `INSERT INTO sessions (
       project_id,
       creator_id,
       title,
       visibility,
       runtime_status,
       bound_agent_node_id,
       bound_agent_session_ref
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, visibility, runtime_status, bound_agent_session_ref`,
    [
      project.id,
      owner.id,
      sessionPayload.title,
      sessionPayload.visibility,
      sessionPayload.runtimeStatus,
      node.id,
      sessionPayload.boundAgentSessionRef,
    ],
  );

  return {
    ownerId: owner.id,
    memberId: member.id,
    teamId: team.id,
    projectId: project.id,
    nodeId: node.id,
    sessionId: session.id,
  };
}

export async function insertMessage(client, input) {
  const {
    rows: [message],
  } = await client.query(
    `INSERT INTO messages (
       session_id,
       sender_type,
       sender_user_id,
       content,
       processing_status,
       is_final_reply,
       sequence_no,
       client_message_id,
       error_summary,
       metadata,
       created_at,
       updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        COALESCE($10, '{}'::jsonb),
        COALESCE($11, now()),
        COALESCE($11, now())
      )
      RETURNING
        id,
        sender_type,
        processing_status,
        is_final_reply,
        client_message_id,
        error_summary`,
    [
      input.sessionId,
      input.senderType,
      input.senderUserId ?? null,
      input.content,
      input.processingStatus,
      input.isFinalReply ?? false,
      input.sequenceNo,
      input.clientMessageId ?? null,
      input.errorSummary ?? null,
      input.metadata ?? null,
      input.createdAt ?? null,
    ],
  );

  return message;
}

export async function createPersistedSessionContext(overrides = {}) {
  const client = await getPool().connect();

  try {
    return await seedSessionContext(client, overrides);
  } finally {
    client.release();
  }
}

export async function cleanupPersistedSessionContext(
  context,
  options = {},
) {
  const userIds = [...new Set([
    context.ownerId,
    context.memberId,
    ...(options.extraUserIds ?? []),
  ])];

  await getPool().query(
    `DELETE FROM projects
     WHERE team_id = $1`,
    [context.teamId],
  );
  await getPool().query(
    `DELETE FROM team_agent_nodes
     WHERE team_id = $1`,
    [context.teamId],
  );
  await getPool().query(`DELETE FROM teams WHERE id = $1`, [context.teamId]);

  if (userIds.length > 0) {
    await getPool().query(
      `DELETE FROM users
       WHERE id = ANY($1::uuid[])`,
      [userIds],
    );
  }
}

export async function withRollbackTransaction(callback) {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    return await callback(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
