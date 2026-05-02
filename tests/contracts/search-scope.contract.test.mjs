import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  assertCursorEnvelope,
  assertInvalidCursorError,
  assertSearchResultContract,
} from "../helpers/http-contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

const group = getDocumentedGroup("contract_search_scope");

after(async () => {
  await closePool();
});

async function archiveProject(projectId) {
  await getPool().query(
    `UPDATE projects
     SET archived_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [projectId],
  );
}

async function insertSessionFixture(context, overrides = {}) {
  const result = await getPool().query(
    `INSERT INTO sessions (
       project_id,
       creator_id,
       title,
       visibility,
       runtime_status,
       bound_agent_node_id,
       bound_agent_session_ref
     )
     VALUES ($1, $2, $3, $4, 'completed', $5, $6)
     RETURNING id`,
    [
      context.projectId,
      overrides.creatorId ?? context.ownerId,
      overrides.title ?? `fixture-${randomUUID()}`,
      overrides.visibility ?? "shared",
      context.nodeId,
      overrides.boundAgentSessionRef ?? `bound-${randomUUID()}`,
    ],
  );

  return result.rows[0].id;
}

async function insertMessageFixture(
  sessionId,
  {
    senderType,
    senderUserId = null,
    content,
    isFinalReply = false,
    sequenceNo,
    createdAt,
  },
) {
  const result = await getPool().query(
    `INSERT INTO messages (
       session_id,
       sender_type,
       sender_user_id,
       content,
       processing_status,
       is_final_reply,
       sequence_no,
       metadata,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, 'completed', $5, $6, '{}'::jsonb, $7, $7)
     RETURNING id`,
    [
      sessionId,
      senderType,
      senderUserId,
      content,
      isFinalReply,
      sequenceNo,
      createdAt,
    ],
  );

  return result.rows[0].id;
}

test(`${group.id} filters out private sessions and non-searchable records while honoring cursor pagination`, async () => {
  const context = await createPersistedSessionContext();

  try {
    const privateSessionId = await insertSessionFixture(context, {
      title: "private-search-session",
      visibility: "private",
    });

    const firstSharedMessageId = await insertMessageFixture(context.sessionId, {
      senderType: "member",
      senderUserId: context.ownerId,
      content: "queue-alpha visible member message",
      sequenceNo: 1,
      createdAt: new Date("2026-04-21T01:00:00.000Z"),
    });
    const ignoredIntermediateId = await insertMessageFixture(context.sessionId, {
      senderType: "agent",
      content: "queue-alpha should stay out of search because it is intermediate",
      sequenceNo: 2,
      createdAt: new Date("2026-04-21T01:01:00.000Z"),
    });
    const secondSharedMessageId = await insertMessageFixture(context.sessionId, {
      senderType: "agent",
      content: "queue-alpha final reply is searchable",
      isFinalReply: true,
      sequenceNo: 3,
      createdAt: new Date("2026-04-21T01:02:00.000Z"),
    });

    await insertMessageFixture(privateSessionId, {
      senderType: "member",
      senderUserId: context.ownerId,
      content: "queue-alpha hidden private message",
      sequenceNo: 1,
      createdAt: new Date("2026-04-21T01:03:00.000Z"),
    });

    await withInjectedApp(async (app) => {
      const searchWithoutActor = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${context.teamId}/search?q=queue-alpha`,
      });

      assert.equal(searchWithoutActor.statusCode, 401);
      assertAuthRequiredError(searchWithoutActor.json());

      const firstPage = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${context.teamId}/search?q=queue-alpha&limit=1`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(firstPage.statusCode, 200);
      const firstPagePayload = firstPage.json();
      assertCursorEnvelope(firstPagePayload, 1);
      assertSearchResultContract(firstPagePayload.data[0], {
        result_type: "message",
        session_id: context.sessionId,
        project_id: context.projectId,
        message_id: secondSharedMessageId,
        sender_type: "agent",
        preview: "queue-alpha final reply is searchable",
        content: "queue-alpha final reply is searchable",
        occurred_at: "2026-04-21T01:02:00.000Z",
        created_at: "2026-04-21T01:02:00.000Z",
      });
      assert.ok(firstPagePayload.meta.next_cursor);
      assert.ok(!("next_cursor" in firstPagePayload));

      const invalidCursor = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${context.teamId}/search?q=queue-alpha&limit=1&cursor=broken-cursor`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(invalidCursor.statusCode, 400);
      assertInvalidCursorError(invalidCursor.json());

      const cursorWithDifferentActor = await app.inject({
        method: "GET",
        url:
          `/api/v1/teams/${context.teamId}/search?q=queue-alpha&limit=1&cursor=` +
          firstPagePayload.meta.next_cursor,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
      });

      assert.equal(cursorWithDifferentActor.statusCode, 400);
      assertInvalidCursorError(cursorWithDifferentActor.json());

      const cursorWithDifferentQuery = await app.inject({
        method: "GET",
        url:
          `/api/v1/teams/${context.teamId}/search?q=queue&limit=1&cursor=` +
          firstPagePayload.meta.next_cursor,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(cursorWithDifferentQuery.statusCode, 400);
      assertInvalidCursorError(cursorWithDifferentQuery.json());

      const secondPage = await app.inject({
        method: "GET",
        url:
          `/api/v1/teams/${context.teamId}/search?q=queue-alpha&limit=1&cursor=` +
          firstPagePayload.meta.next_cursor,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(secondPage.statusCode, 200);
      const secondPagePayload = secondPage.json();
      assertCursorEnvelope(secondPagePayload, 1);
      assertSearchResultContract(secondPagePayload.data[0], {
        result_type: "message",
        session_id: context.sessionId,
        project_id: context.projectId,
        message_id: firstSharedMessageId,
        sender_type: "member",
        preview: "queue-alpha visible member message",
        content: "queue-alpha visible member message",
        occurred_at: "2026-04-21T01:00:00.000Z",
        created_at: "2026-04-21T01:00:00.000Z",
      });
      assert.equal(secondPagePayload.meta.next_cursor, null);

      const collectedIds = [
        firstPagePayload.data[0].message_id,
        secondPagePayload.data[0].message_id,
      ];
      assert.deepEqual(collectedIds, [
        secondSharedMessageId,
        firstSharedMessageId,
      ]);
      assert.ok(!collectedIds.includes(ignoredIntermediateId));
    });
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});

test(`${group.id} includes searchable session event summaries in search results`, async () => {
  const context = await createPersistedSessionContext();

  try {
    const eventResult = await getPool().query(
      `INSERT INTO session_events (
         session_id,
         related_message_id,
         event_type,
         summary,
         payload,
         occurred_at
       )
       VALUES (
         $1,
         NULL,
         'command.summary',
         $2,
         '{"command":"npm run build"}'::jsonb,
         $3
       )
       RETURNING id`,
      [
        context.sessionId,
        "build command completed with warnings",
        new Date("2026-04-21T01:30:00.000Z"),
      ],
    );

    await withInjectedApp(async (app) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${context.teamId}/search?q=build command`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(response.statusCode, 200);
      const payload = response.json();
      assertCursorEnvelope(payload, 1);
      assertSearchResultContract(payload.data[0], {
        result_type: "event",
        session_id: context.sessionId,
        project_id: context.projectId,
        message_id: null,
        event_id: eventResult.rows[0].id,
        sender_type: null,
        event_type: "command.summary",
        preview: "build command completed with warnings",
        content: "build command completed with warnings",
        occurred_at: "2026-04-21T01:30:00.000Z",
        created_at: "2026-04-21T01:30:00.000Z",
      });
      assert.equal(payload.meta.total, 1);
      assert.equal(payload.meta.next_cursor, null);
    });
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});

test(`${group.id} drops shared-session search results after the owner privatizes the session`, async () => {
  const context = await createPersistedSessionContext();

  try {
    await insertMessageFixture(context.sessionId, {
      senderType: "member",
      senderUserId: context.ownerId,
      content: "scope-switch-keyword",
      sequenceNo: 1,
      createdAt: new Date("2026-04-21T02:00:00.000Z"),
    });

    await withInjectedApp(async (app) => {
      const beforePatch = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${context.teamId}/search?q=scope-switch-keyword`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(beforePatch.statusCode, 200);
      const beforePatchPayload = beforePatch.json();
      assertCursorEnvelope(beforePatchPayload, 1);
      assertSearchResultContract(beforePatchPayload.data[0], {
        result_type: "message",
        session_id: context.sessionId,
        project_id: context.projectId,
        sender_type: "member",
        preview: "scope-switch-keyword",
        content: "scope-switch-keyword",
      });
      assert.equal(beforePatchPayload.meta.next_cursor, null);

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

      const afterPatch = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${context.teamId}/search?q=scope-switch-keyword`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(afterPatch.statusCode, 200);
      const afterPatchPayload = afterPatch.json();
      assertCursorEnvelope(afterPatchPayload, 0);
      assert.deepEqual(afterPatchPayload.data, []);
      assert.equal(afterPatchPayload.meta.next_cursor, null);
    });
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});

test(`${group.id} excludes archived-project sessions from search results`, async () => {
  const context = await createPersistedSessionContext();

  try {
    const searchableMessageId = await insertMessageFixture(context.sessionId, {
      senderType: "member",
      senderUserId: context.ownerId,
      content: "archive-search-keyword",
      sequenceNo: 1,
      createdAt: new Date("2026-04-21T03:00:00.000Z"),
    });

    await withInjectedApp(async (app) => {
      const beforeArchive = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${context.teamId}/search?q=archive-search-keyword`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(beforeArchive.statusCode, 200);
      const beforeArchivePayload = beforeArchive.json();
      assertCursorEnvelope(beforeArchivePayload, 1);
      assertSearchResultContract(beforeArchivePayload.data[0], {
        result_type: "message",
        session_id: context.sessionId,
        project_id: context.projectId,
        message_id: searchableMessageId,
        sender_type: "member",
        preview: "archive-search-keyword",
        content: "archive-search-keyword",
        occurred_at: "2026-04-21T03:00:00.000Z",
        created_at: "2026-04-21T03:00:00.000Z",
      });
      assert.equal(beforeArchivePayload.meta.next_cursor, null);

      await archiveProject(context.projectId);

      const afterArchive = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${context.teamId}/search?q=archive-search-keyword`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(afterArchive.statusCode, 200);
      const afterArchivePayload = afterArchive.json();
      assertCursorEnvelope(afterArchivePayload, 0);
      assert.deepEqual(afterArchivePayload.data, []);
      assert.equal(afterArchivePayload.meta.next_cursor, null);
    });
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});
