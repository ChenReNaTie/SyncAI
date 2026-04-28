import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  closePool,
  getPool,
  seedSessionContext,
} from "../helpers/database.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

after(async () => {
  await closePool();
});

async function createPersistedSessionContext(overrides = {}) {
  const client = await getPool().connect();

  try {
    return await seedSessionContext(client, overrides);
  } finally {
    client.release();
  }
}

async function cleanupPersistedSessionContext(context) {
  await getPool().query(
    `DELETE FROM projects
     WHERE team_id = $1`,
    [context.teamId],
  );
  await getPool().query(`DELETE FROM teams WHERE id = $1`, [context.teamId]);
  await getPool().query(
    `DELETE FROM users
     WHERE id = ANY($1::uuid[])`,
    [[context.ownerId, context.memberId]],
  );
}

test(
  "integration_workspace_runtime completes the first accepted member message and stores the mock reply",
  async () => {
    const context = await createPersistedSessionContext({
      runtimeStatus: "idle",
    });

    try {
      await withInjectedApp(async (app) => {
        const actorHeaders = {
          "x-syncai-user-id": context.memberId,
        };

        const response = await app.inject({
          method: "POST",
          url: `/api/v1/sessions/${context.sessionId}/messages`,
          headers: actorHeaders,
          payload: {
            content: "Complete the queue processing path",
            client_message_id: "workspace-runtime-001",
          },
        });

        assert.equal(response.statusCode, 201);

        const payload = response.json();
        assert.equal(payload.data.message.processing_status, "accepted");
        assert.equal(
          payload.data.dispatch_state.session_runtime_status,
          "queued",
        );

        await app.workspaceRuntime.waitForSession(context.sessionId);

        const messagesResult = await getPool().query(
          `SELECT sender_type, processing_status, is_final_reply, content
           FROM messages
           WHERE session_id = $1
           ORDER BY sequence_no ASC`,
          [context.sessionId],
        );

        assert.equal(messagesResult.rows.length, 2);
        assert.deepEqual(messagesResult.rows.map((row) => row.sender_type), [
          "member",
          "agent",
        ]);
        assert.equal(messagesResult.rows[0].processing_status, "completed");
        assert.equal(messagesResult.rows[1].is_final_reply, true);
        assert.match(messagesResult.rows[1].content, /Mock Codex completed/u);

        const eventsResult = await getPool().query(
          `SELECT event_type
           FROM session_events
           WHERE session_id = $1
           ORDER BY occurred_at ASC, created_at ASC`,
          [context.sessionId],
        );

        assert.ok(
          eventsResult.rows.some((row) => row.event_type === "command.summary"),
        );
        assert.ok(
          eventsResult.rows.some((row) => row.event_type === "status.changed"),
        );

        const sessionResult = await getPool().query(
          `SELECT runtime_status
           FROM sessions
           WHERE id = $1`,
          [context.sessionId],
        );
        assert.equal(sessionResult.rows[0].runtime_status, "completed");
      });
    } finally {
      await cleanupPersistedSessionContext(context);
    }
  },
);

test(
  "integration_workspace_runtime keeps later member messages queued behind the running one",
  async () => {
    const context = await createPersistedSessionContext({
      runtimeStatus: "idle",
    });

    try {
      await withInjectedApp(
        async (app) => {
          const actorHeaders = {
            "x-syncai-user-id": context.memberId,
          };

          const firstResponse = await app.inject({
            method: "POST",
            url: `/api/v1/sessions/${context.sessionId}/messages`,
            headers: actorHeaders,
            payload: {
              content: "First queued job",
              client_message_id: "workspace-runtime-queue-001",
            },
          });
          const secondResponse = await app.inject({
            method: "POST",
            url: `/api/v1/sessions/${context.sessionId}/messages`,
            headers: actorHeaders,
            payload: {
              content: "Second queued job",
              client_message_id: "workspace-runtime-queue-002",
            },
          });

          assert.equal(firstResponse.statusCode, 201);
          assert.equal(secondResponse.statusCode, 201);
          assert.equal(
            secondResponse.json().data.message.processing_status,
            "queued",
          );

          await app.workspaceRuntime.waitForSession(context.sessionId);

          const queuedEvents = await getPool().query(
            `SELECT event_type, payload
             FROM session_events
             WHERE session_id = $1
             ORDER BY occurred_at ASC, created_at ASC`,
            [context.sessionId],
          );

          assert.ok(
            queuedEvents.rows.some((row) => row.event_type === "message.queued"),
          );

          const memberMessages = await getPool().query(
            `SELECT content, processing_status
             FROM messages
             WHERE session_id = $1
               AND sender_type = 'member'
             ORDER BY sequence_no ASC`,
            [context.sessionId],
          );

          assert.deepEqual(
            memberMessages.rows.map((row) => row.content),
            ["First queued job", "Second queued job"],
          );
          assert.deepEqual(
            memberMessages.rows.map((row) => row.processing_status),
            ["completed", "completed"],
          );
        },
        {
          SYNCAI_MOCK_AGENT_LATENCY_MS: "80",
        },
      );
    } finally {
      await cleanupPersistedSessionContext(context);
    }
  },
);

test(
  "integration_workspace_runtime records readable failure details when the mock adapter errors",
  async () => {
    const context = await createPersistedSessionContext({
      runtimeStatus: "idle",
    });

    try {
      await withInjectedApp(async (app) => {
        const actorHeaders = {
          "x-syncai-user-id": context.memberId,
        };

        const response = await app.inject({
          method: "POST",
          url: `/api/v1/sessions/${context.sessionId}/messages`,
          headers: actorHeaders,
          payload: {
            content: "[mock-fail] Simulate a Codex failure",
            client_message_id: "workspace-runtime-failure-001",
          },
        });

        assert.equal(response.statusCode, 201);

        await app.workspaceRuntime.waitForSession(context.sessionId);

        const failedMessage = await getPool().query(
          `SELECT processing_status, error_summary
           FROM messages
           WHERE session_id = $1
             AND sender_type = 'member'
           ORDER BY sequence_no ASC
           LIMIT 1`,
          [context.sessionId],
        );

        assert.equal(failedMessage.rows[0].processing_status, "failed");
        assert.match(failedMessage.rows[0].error_summary, /Mock Codex failed/u);

        const failureEvents = await getPool().query(
          `SELECT event_type, payload
           FROM session_events
           WHERE session_id = $1
           ORDER BY occurred_at ASC, created_at ASC`,
          [context.sessionId],
        );

        assert.ok(
          failureEvents.rows.some((row) => row.event_type === "message.failed"),
        );

        const sessionResult = await getPool().query(
          `SELECT runtime_status
           FROM sessions
           WHERE id = $1`,
          [context.sessionId],
        );
        assert.equal(sessionResult.rows[0].runtime_status, "error");
      });
    } finally {
      await cleanupPersistedSessionContext(context);
    }
  },
);
