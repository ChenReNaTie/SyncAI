import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  closePool,
  seedSessionContext,
  withRollbackTransaction,
} from "../helpers/database.mjs";

after(async () => {
  await closePool();
});

test("integration_session_binding_visibility requires immediate node binding at session creation time", async () => {
  await withRollbackTransaction(async (client) => {
    const context = await seedSessionContext(client);

    await assert.rejects(
      client.query(
        `INSERT INTO sessions (
           project_id,
           creator_id,
           title,
           visibility,
           runtime_status,
           bound_agent_session_ref
         )
         VALUES ($1, $2, $3, 'shared', 'idle', $4)`,
        [
          context.projectId,
          context.ownerId,
          "missing-node-binding",
          "bound-session-missing-node",
        ],
      ),
      (error) => error?.code === "23502",
    );
  });
});

test("integration_session_binding_visibility accepts shared and private sessions plus audit snapshots", async () => {
  await withRollbackTransaction(async (client) => {
    const sharedContext = await seedSessionContext(client, {
      visibility: "shared",
    });

    const privateContext = await seedSessionContext(client, {
      visibility: "private",
      title: "private-session",
    });

    const sessions = await client.query(
      `SELECT visibility
       FROM sessions
       WHERE id = ANY($1::uuid[])
       ORDER BY visibility`,
      [[sharedContext.sessionId, privateContext.sessionId]],
    );

    assert.deepEqual(
      sessions.rows.map((row) => row.visibility).sort(),
      ["private", "shared"],
    );

    await client.query(
      `INSERT INTO session_audit_logs (
         session_id,
         action_type,
         previous_visibility,
         new_visibility,
         visible_scope_snapshot,
         shared_started_at,
         shared_ended_at,
         operator_id
       )
       VALUES ($1, 'visibility.changed', 'shared', 'private', $2::jsonb, now(), now(), $3)`,
      [
        sharedContext.sessionId,
        JSON.stringify([{ userId: sharedContext.ownerId }, { userId: sharedContext.memberId }]),
        sharedContext.ownerId,
      ],
    );

    const auditResult = await client.query(
      `SELECT previous_visibility, new_visibility, jsonb_array_length(visible_scope_snapshot) AS scope_size
       FROM session_audit_logs
       WHERE session_id = $1`,
      [sharedContext.sessionId],
    );

    assert.equal(auditResult.rows[0].previous_visibility, "shared");
    assert.equal(auditResult.rows[0].new_visibility, "private");
    assert.equal(auditResult.rows[0].scope_size, 2);
  });
});
