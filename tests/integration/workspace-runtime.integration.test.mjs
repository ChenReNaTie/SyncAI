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
        const emittedMessages = [];
        const handleMessageNew = (event) => {
          emittedMessages.push(event.message);
        };

        app.workspaceRuntime.on("message.new", handleMessageNew);

        try {
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
          assert.equal(payload.data.message.sender_display_name, "Member");
          assert.equal(
            payload.data.dispatch_state.session_runtime_status,
            "queued",
          );

          await app.workspaceRuntime.waitForSession(context.sessionId);

          const messagesResult = await getPool().query(
            `SELECT sender_type, processing_status, is_final_reply, content, metadata
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
          assert.equal(messagesResult.rows[1].metadata.codex_runtime.model, "mock-gpt");
          assert.equal(messagesResult.rows[1].metadata.codex_runtime.reasoning_effort, "medium");
          assert.equal(
            messagesResult.rows[1].metadata.execution_trace.commands[0].command,
            "ls -la",
          );
          assert.equal(
            messagesResult.rows[1].metadata.execution_trace.file_diffs[0].path,
            "src/mock-file.ts",
          );

          assert.equal(emittedMessages.length, 2);
          assert.equal(emittedMessages[0].sender_display_name, "Member");
          assert.equal(emittedMessages[0].sender_type, "member");
          assert.equal(emittedMessages[1].sender_display_name, "Codex");
          assert.equal(emittedMessages[1].sender_type, "agent");
          assert.equal(emittedMessages[1].sender_user_id, null);
          assert.equal(emittedMessages[1].metadata.codex_runtime.model, "mock-gpt");

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

          const agentContextResponse = await app.inject({
            method: "GET",
            url: `/api/v1/sessions/${context.sessionId}/agent-context`,
            headers: actorHeaders,
          });

          assert.equal(agentContextResponse.statusCode, 200);
          assert.deepEqual(agentContextResponse.json(), {
            data: {
              thread_id: "mock-thread-001",
              model: "mock-gpt",
              model_provider: "mock",
              reasoning_effort: "medium",
              approval_policy: "never",
              sandbox_mode: "workspace-write",
              network_access: false,
              branch: "mock/main",
              working_directory: null,
              cli_version: "mock",
              source: "mock",
            },
          });
        } finally {
          app.workspaceRuntime.off("message.new", handleMessageNew);
        }
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
  "integration_workspace_runtime applies editable agent config selections to subsequent mock turns",
  async () => {
    const context = await createPersistedSessionContext({
      runtimeStatus: "idle",
    });

    try {
      await withInjectedApp(async (app) => {
        const ownerHeaders = {
          "x-syncai-user-id": context.ownerId,
        };
        const memberHeaders = {
          "x-syncai-user-id": context.memberId,
        };

        const updateResponse = await app.inject({
          method: "PATCH",
          url: `/api/v1/sessions/${context.sessionId}/agent-config`,
          headers: ownerHeaders,
          payload: {
            model: "gpt-5.5",
            reasoning_effort: "xhigh",
            approval_policy: "never",
            sandbox_mode: "danger-full-access",
            branch: "main",
          },
        });

        assert.equal(updateResponse.statusCode, 200);
        assert.equal(updateResponse.json().data.selected.model, "gpt-5.5");
        assert.equal(updateResponse.json().data.selected.reasoning_effort, "xhigh");
        assert.equal(updateResponse.json().data.selected.approval_policy, "never");
        assert.equal(updateResponse.json().data.selected.sandbox_mode, "danger-full-access");
        assert.equal(updateResponse.json().data.selected.branch, "main");
        assert.ok(Array.isArray(updateResponse.json().data.options.reasoning_efforts));
        assert.ok(Array.isArray(updateResponse.json().data.options.approval_policies));
        assert.ok(Array.isArray(updateResponse.json().data.options.sandbox_modes));

        const messageResponse = await app.inject({
          method: "POST",
          url: `/api/v1/sessions/${context.sessionId}/messages`,
          headers: memberHeaders,
          payload: {
            content: "Run using the updated config",
            client_message_id: "workspace-runtime-config-001",
          },
        });

        assert.equal(messageResponse.statusCode, 201);

        await app.workspaceRuntime.waitForSession(context.sessionId);

        const agentMessage = await getPool().query(
          `SELECT metadata
           FROM messages
           WHERE session_id = $1
             AND sender_type = 'agent'
             AND is_final_reply = TRUE
           ORDER BY sequence_no DESC
           LIMIT 1`,
          [context.sessionId],
        );

        assert.equal(agentMessage.rows[0].metadata.codex_runtime.model, "gpt-5.5");
        assert.equal(agentMessage.rows[0].metadata.codex_runtime.reasoning_effort, "xhigh");
        assert.equal(agentMessage.rows[0].metadata.codex_runtime.approval_policy, "never");
        assert.equal(agentMessage.rows[0].metadata.codex_runtime.sandbox_mode, "danger-full-access");
        assert.equal(agentMessage.rows[0].metadata.codex_runtime.branch, "main");
      });
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
