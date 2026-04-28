import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getDocumentedGroup } from "../fixtures/requirements-map.mjs";
import {
  cleanupPersistedSessionContext,
  closePool,
  createPersistedSessionContext,
  getPool,
  insertMessage,
} from "../helpers/database.mjs";
import {
  assertAuthRequiredError,
  assertReplayCommandSummaryEntry,
  assertReplayMessageEntry,
  assertReplayStatusChangedEntry,
  assertReplayVisibilityChangedEntry,
  assertSessionContract,
  assertSessionNotVisibleError,
  assertStrictKeys,
} from "../helpers/http-contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

const group = getDocumentedGroup("contract_replay_scope");

after(async () => {
  await closePool();
});

test(`${group.id} returns only replayable entry types and revokes access after privatization`, async () => {
  const context = await createPersistedSessionContext();

  try {
    const memberMessage = await insertMessage(await getPool(), {
      sessionId: context.sessionId,
      senderType: "member",
      senderUserId: context.ownerId,
      content: "Please tighten replay visibility",
      processingStatus: "completed",
      sequenceNo: 1,
      createdAt: new Date("2026-04-21T03:00:00.000Z"),
    });

    await getPool().query(
      `INSERT INTO session_events (
         session_id,
         related_message_id,
         event_type,
         summary,
         payload,
         occurred_at
       )
       VALUES
       ($1, $2, 'status.changed', 'Session started processing the next queued message', $3::jsonb, $4),
       ($1, $2, 'command.summary', 'Reviewed the replay boundary', $5::jsonb, $6)`,
      [
        context.sessionId,
        memberMessage.id,
        JSON.stringify({ from: "idle", to: "running" }),
        new Date("2026-04-21T03:00:01.000Z"),
        JSON.stringify({ message_id: memberMessage.id }),
        new Date("2026-04-21T03:00:02.000Z"),
      ],
    );

    await withInjectedApp(async (app) => {
      const replayWithoutActor = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/replay`,
      });

      assert.equal(replayWithoutActor.statusCode, 401);
      assertAuthRequiredError(replayWithoutActor.json());

      const sharedReplay = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/replay`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(sharedReplay.statusCode, 200);
      const sharedReplayPayload = sharedReplay.json();
      assertStrictKeys(sharedReplayPayload, ["data"]);
      assert.equal(sharedReplayPayload.data.length, 3);
      assertReplayMessageEntry(sharedReplayPayload.data[0], {
        message_id: memberMessage.id,
        occurred_at: "2026-04-21T03:00:00.000Z",
        sender_type: "member",
        content: "Please tighten replay visibility",
      });
      assertReplayStatusChangedEntry(sharedReplayPayload.data[1], {
        occurred_at: "2026-04-21T03:00:01.000Z",
        from: "idle",
        to: "running",
        summary: "Session started processing the next queued message",
      });
      assertReplayCommandSummaryEntry(sharedReplayPayload.data[2], {
        occurred_at: "2026-04-21T03:00:02.000Z",
        summary: "Reviewed the replay boundary",
      });

      const privatize = await app.inject({
        method: "PATCH",
        url: `/api/v1/sessions/${context.sessionId}/visibility`,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
        payload: {
          visibility: "private",
        },
      });

      assert.equal(privatize.statusCode, 200);
      const privatizePayload = privatize.json();
      assertStrictKeys(privatizePayload, ["data"]);
      assertSessionContract(privatizePayload.data, {
        id: context.sessionId,
        project_id: context.projectId,
        creator_id: context.ownerId,
        visibility: "private",
        runtime_status: "idle",
        bound_agent_node_id: context.nodeId,
        pending_count: 0,
      });

      const hiddenReplay = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/replay`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(hiddenReplay.statusCode, 403);
      assertSessionNotVisibleError(hiddenReplay.json());

      const reshare = await app.inject({
        method: "PATCH",
        url: `/api/v1/sessions/${context.sessionId}/visibility`,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
        payload: {
          visibility: "shared",
        },
      });

      assert.equal(reshare.statusCode, 200);
      const resharePayload = reshare.json();
      assertStrictKeys(resharePayload, ["data"]);
      assertSessionContract(resharePayload.data, {
        id: context.sessionId,
        project_id: context.projectId,
        creator_id: context.ownerId,
        visibility: "shared",
        runtime_status: "idle",
        bound_agent_node_id: context.nodeId,
        pending_count: 0,
      });

      const restoredReplay = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/replay`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(restoredReplay.statusCode, 200);
      const restoredReplayPayload = restoredReplay.json();
      assertStrictKeys(restoredReplayPayload, ["data"]);
      assert.equal(restoredReplayPayload.data.length, 5);
      assertReplayMessageEntry(restoredReplayPayload.data[0], {
        message_id: memberMessage.id,
        occurred_at: "2026-04-21T03:00:00.000Z",
        sender_type: "member",
        content: "Please tighten replay visibility",
      });
      assertReplayStatusChangedEntry(restoredReplayPayload.data[1], {
        occurred_at: "2026-04-21T03:00:01.000Z",
        from: "idle",
        to: "running",
        summary: "Session started processing the next queued message",
      });
      assertReplayCommandSummaryEntry(restoredReplayPayload.data[2], {
        occurred_at: "2026-04-21T03:00:02.000Z",
        summary: "Reviewed the replay boundary",
      });
      assertReplayVisibilityChangedEntry(restoredReplayPayload.data[3], {
        from: "shared",
        to: "private",
        summary: "Session visibility changed to private",
      });
      assertReplayVisibilityChangedEntry(restoredReplayPayload.data[4], {
        from: "private",
        to: "shared",
        summary: "Session visibility changed to shared",
      });
    });
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});
