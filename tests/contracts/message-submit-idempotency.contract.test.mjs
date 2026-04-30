import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getDocumentedGroup } from "../fixtures/requirements-map.mjs";
import {
  cleanupPersistedSessionContext,
  closePool,
  createPersistedSessionContext,
  getPool,
} from "../helpers/database.mjs";
import {
  assertAuthRequiredError,
  assertMessageContract,
  assertStrictKeys,
} from "../helpers/http-contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

const group = getDocumentedGroup("contract_message_submit_idempotency");

after(async () => {
  await closePool();
});

test(`${group.id} replays the existing member message for duplicate client_message_id without duplicating records`, async () => {
  const context = await createPersistedSessionContext();

  try {
    await withInjectedApp(
      async (app) => {
        const missingActor = await app.inject({
          method: "POST",
          url: `/api/v1/sessions/${context.sessionId}/messages`,
          payload: {
            content: "Drive the same Codex session forward",
            client_message_id: "missing-actor-idempotency",
          },
        });

        assert.equal(missingActor.statusCode, 401);
        assertAuthRequiredError(missingActor.json());

        const request = {
          method: "POST",
          url: `/api/v1/sessions/${context.sessionId}/messages`,
          headers: {
            "x-syncai-user-id": context.memberId,
          },
          payload: {
            content: "Drive the same Codex session forward",
            client_message_id: "web-1744680000-001",
          },
        };

        const first = await app.inject(request);
        const second = await app.inject(request);

        assert.equal(first.statusCode, 201);
        assert.equal(second.statusCode, 200);
        const firstPayload = first.json();
        const secondPayload = second.json();
        assertStrictKeys(firstPayload, ["data"]);
        assertStrictKeys(firstPayload.data, ["dispatch_state", "message"]);
        assertMessageContract(firstPayload.data.message, {
          session_id: context.sessionId,
          sender_type: "member",
          sender_user_id: context.memberId,
          sender_display_name: "Member",
          content: "Drive the same Codex session forward",
          processing_status: "accepted",
          is_final_reply: false,
          client_message_id: "web-1744680000-001",
          error_summary: null,
        });
        assert.deepEqual(firstPayload.data.message.metadata, {});
        assertStrictKeys(firstPayload.data.dispatch_state, [
          "queue_position",
          "session_runtime_status",
        ]);
        assert.equal(firstPayload.data.dispatch_state.session_runtime_status, "queued");
        assert.equal(firstPayload.data.dispatch_state.queue_position, 1);

        assertStrictKeys(secondPayload, ["data"]);
        assertStrictKeys(secondPayload.data, [
          "dispatch_state",
          "duplicated",
          "idempotent_replay",
          "message",
        ]);
        assert.equal(
          firstPayload.data.message.id,
          secondPayload.data.message.id,
        );
        assert.equal(
          secondPayload.data.message.sender_user_id,
          context.memberId,
        );
        assertMessageContract(secondPayload.data.message, {
          id: firstPayload.data.message.id,
          session_id: context.sessionId,
          sender_type: "member",
          sender_user_id: context.memberId,
          sender_display_name: "Member",
          content: "Drive the same Codex session forward",
          processing_status: "accepted",
          is_final_reply: false,
          client_message_id: "web-1744680000-001",
          error_summary: null,
        });
        assert.deepEqual(secondPayload.data.message, firstPayload.data.message);
        assertStrictKeys(secondPayload.data.dispatch_state, [
          "queue_position",
          "session_runtime_status",
        ]);
        assert.equal(
          secondPayload.data.dispatch_state.session_runtime_status,
          "queued",
        );
        assert.equal(secondPayload.data.dispatch_state.queue_position, 0);
        assert.equal(secondPayload.data.duplicated, true);
        assert.equal(secondPayload.data.idempotent_replay, true);
        assert.ok(!("duplicated" in firstPayload.data));
        assert.ok(!("idempotent_replay" in firstPayload.data));

        await app.workspaceRuntime.waitForSession(context.sessionId);

        const messageCounts = await getPool().query(
          `SELECT
             count(*) FILTER (WHERE sender_type = 'member')::int AS member_count,
             count(*) FILTER (
               WHERE sender_type = 'agent' AND is_final_reply = TRUE
             )::int AS final_reply_count
           FROM messages
           WHERE session_id = $1`,
          [context.sessionId],
        );

        assert.equal(messageCounts.rows[0].member_count, 1);
        assert.equal(messageCounts.rows[0].final_reply_count, 1);

        const duplicateEvents = await getPool().query(
          `SELECT count(*)::int AS event_count
           FROM session_events
           WHERE session_id = $1
             AND event_type = 'message.queued'`,
          [context.sessionId],
        );

        assert.equal(duplicateEvents.rows[0].event_count, 0);
      },
      {
        SYNCAI_MOCK_AGENT_LATENCY_MS: "120",
      },
    );
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});
