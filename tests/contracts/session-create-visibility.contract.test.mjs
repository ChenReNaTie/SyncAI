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
  assertSessionContract,
  assertSessionNotVisibleError,
  assertStrictKeys,
} from "../helpers/http-contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

const group = getDocumentedGroup("contract_session_create_visibility");

after(async () => {
  await closePool();
});

async function insertSessionFixture(context, overrides = {}) {
  const timestamp = overrides.timestamp ?? new Date();
  const result = await getPool().query(
    `INSERT INTO sessions (
       project_id,
       creator_id,
       title,
       visibility,
       runtime_status,
       bound_agent_node_id,
       bound_agent_session_ref,
       last_message_at,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, 'idle', $5, $6, $7, $7, $7)
     RETURNING id`,
    [
      context.projectId,
      overrides.creatorId ?? context.ownerId,
      overrides.title ?? `fixture-${randomUUID()}`,
      overrides.visibility ?? "shared",
      context.nodeId,
      overrides.boundAgentSessionRef ?? `bound-${randomUUID()}`,
      timestamp,
    ],
  );

  return result.rows[0].id;
}

test(`${group.id} creates sessions under the current actor instead of the project creator`, async () => {
  const context = await createPersistedSessionContext();

  try {
    await withInjectedApp(async (app) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${context.projectId}/sessions`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
        payload: {
          title: "member-owned private session",
          visibility: "private",
        },
      });

      assert.equal(response.statusCode, 201);

      const payload = response.json();
      assertStrictKeys(payload, ["data"]);
      assertSessionContract(payload.data, {
        project_id: context.projectId,
        creator_id: context.memberId,
        title: "member-owned private session",
        visibility: "private",
        runtime_status: "idle",
        bound_agent_node_id: context.nodeId,
        pending_count: 0,
        last_message_at: null,
      });

      const authorizationResponse = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${context.projectId}/sessions`,
        headers: {
          authorization: `Bearer ${context.memberId}`,
        },
        payload: {
          title: "member-owned shared session via bearer",
          visibility: "shared",
        },
      });

      assert.equal(authorizationResponse.statusCode, 201);
      const authorizationPayload = authorizationResponse.json();
      assertStrictKeys(authorizationPayload, ["data"]);
      assertSessionContract(authorizationPayload.data, {
        project_id: context.projectId,
        creator_id: context.memberId,
        title: "member-owned shared session via bearer",
        visibility: "shared",
        runtime_status: "idle",
        bound_agent_node_id: context.nodeId,
        pending_count: 0,
        last_message_at: null,
      });
    });
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});

test(`${group.id} requires an explicit actor context instead of falling back to creator fields`, async () => {
  const context = await createPersistedSessionContext();

  try {
    await withInjectedApp(async (app) => {
      const createWithoutActor = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${context.projectId}/sessions`,
        payload: {
          title: "missing actor session",
          visibility: "shared",
        },
      });

      assert.equal(createWithoutActor.statusCode, 401);
      assertAuthRequiredError(createWithoutActor.json());

      const createWithInvalidActor = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${context.projectId}/sessions`,
        headers: {
          "x-syncai-user-id": "invalid-user-id",
        },
        payload: {
          title: "invalid actor session",
          visibility: "shared",
        },
      });

      assert.equal(createWithInvalidActor.statusCode, 401);
      assertAuthRequiredError(createWithInvalidActor.json());

      const createWithMalformedBearer = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${context.projectId}/sessions`,
        headers: {
          authorization: "Token not-a-bearer",
        },
        payload: {
          title: "malformed bearer session",
          visibility: "shared",
        },
      });

      assert.equal(createWithMalformedBearer.statusCode, 401);
      assertAuthRequiredError(createWithMalformedBearer.json());

      const listWithoutActor = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${context.projectId}/sessions`,
      });

      assert.equal(listWithoutActor.statusCode, 401);
      assertAuthRequiredError(listWithoutActor.json());

      const detailWithoutActor = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}`,
      });

      assert.equal(detailWithoutActor.statusCode, 401);
      assertAuthRequiredError(detailWithoutActor.json());
    });
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});

test(`${group.id} enforces list/detail visibility and stable cursor pagination`, async () => {
  const context = await createPersistedSessionContext();

  try {
    await getPool().query(
      `DELETE FROM sessions
       WHERE id = $1`,
      [context.sessionId],
    );

    const olderSharedId = await insertSessionFixture(context, {
      title: "shared-older",
      visibility: "shared",
      timestamp: new Date("2026-04-21T00:00:00.000Z"),
    });
    const hiddenPrivateId = await insertSessionFixture(context, {
      title: "hidden-private",
      visibility: "private",
      timestamp: new Date("2026-04-21T00:02:00.000Z"),
    });
    const newerSharedId = await insertSessionFixture(context, {
      title: "shared-newer",
      visibility: "shared",
      timestamp: new Date("2026-04-21T00:03:00.000Z"),
    });

    await withInjectedApp(async (app) => {
      const firstPage = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${context.projectId}/sessions?limit=1`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(firstPage.statusCode, 200);
      const firstPagePayload = firstPage.json();
      assertCursorEnvelope(firstPagePayload, 1);
      assertSessionContract(firstPagePayload.data[0], {
        id: newerSharedId,
        project_id: context.projectId,
        creator_id: context.ownerId,
        title: "shared-newer",
        visibility: "shared",
        runtime_status: "idle",
        bound_agent_node_id: context.nodeId,
        bound_agent_session_ref: firstPagePayload.data[0].bound_agent_session_ref,
        last_message_at: "2026-04-21T00:03:00.000Z",
        pending_count: 0,
      });
      assert.ok(firstPagePayload.meta.next_cursor);
      assert.ok(!("next_cursor" in firstPagePayload));

      const invalidCursor = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${context.projectId}/sessions?limit=1&cursor=broken-cursor`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(invalidCursor.statusCode, 400);
      assertInvalidCursorError(invalidCursor.json());

      const cursorWithDifferentActor = await app.inject({
        method: "GET",
        url:
          `/api/v1/projects/${context.projectId}/sessions?limit=1&cursor=` +
          firstPagePayload.meta.next_cursor,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
      });

      assert.equal(cursorWithDifferentActor.statusCode, 400);
      assertInvalidCursorError(cursorWithDifferentActor.json());

      const cursorWithDifferentVisibility = await app.inject({
        method: "GET",
        url:
          `/api/v1/projects/${context.projectId}/sessions?limit=1&visibility=shared&cursor=` +
          firstPagePayload.meta.next_cursor,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(cursorWithDifferentVisibility.statusCode, 400);
      assertInvalidCursorError(cursorWithDifferentVisibility.json());

      const secondPage = await app.inject({
        method: "GET",
        url:
          `/api/v1/projects/${context.projectId}/sessions?limit=1&cursor=` +
          firstPagePayload.meta.next_cursor,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(secondPage.statusCode, 200);
      const secondPagePayload = secondPage.json();
      assertCursorEnvelope(secondPagePayload, 1);
      assertSessionContract(secondPagePayload.data[0], {
        id: olderSharedId,
        project_id: context.projectId,
        creator_id: context.ownerId,
        title: "shared-older",
        visibility: "shared",
        runtime_status: "idle",
        bound_agent_node_id: context.nodeId,
        bound_agent_session_ref: secondPagePayload.data[0].bound_agent_session_ref,
        last_message_at: "2026-04-21T00:00:00.000Z",
        pending_count: 0,
      });
      assert.equal(secondPagePayload.meta.next_cursor, null);

      const listedIds = [
        firstPagePayload.data[0].id,
        secondPagePayload.data[0].id,
      ];
      assert.deepEqual(listedIds, [newerSharedId, olderSharedId]);
      assert.ok(!listedIds.includes(hiddenPrivateId));

      const visibleDetail = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${newerSharedId}`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(visibleDetail.statusCode, 200);
      const visibleDetailPayload = visibleDetail.json();
      assertStrictKeys(visibleDetailPayload, ["data"]);
      assertSessionContract(visibleDetailPayload.data, {
        id: newerSharedId,
        project_id: context.projectId,
        creator_id: context.ownerId,
        title: "shared-newer",
        visibility: "shared",
        runtime_status: "idle",
        bound_agent_node_id: context.nodeId,
        bound_agent_session_ref: firstPagePayload.data[0].bound_agent_session_ref,
        last_message_at: "2026-04-21T00:03:00.000Z",
        pending_count: 0,
      });

      const hiddenDetail = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${hiddenPrivateId}`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(hiddenDetail.statusCode, 403);
      assertSessionNotVisibleError(hiddenDetail.json());

      const reshare = await app.inject({
        method: "PATCH",
        url: `/api/v1/sessions/${hiddenPrivateId}/visibility`,
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
        id: hiddenPrivateId,
        project_id: context.projectId,
        creator_id: context.ownerId,
        title: "hidden-private",
        visibility: "shared",
        runtime_status: "idle",
        bound_agent_node_id: context.nodeId,
        last_message_at: "2026-04-21T00:02:00.000Z",
        pending_count: 0,
      });

      const restoredDetail = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${hiddenPrivateId}`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(restoredDetail.statusCode, 200);
      const restoredDetailPayload = restoredDetail.json();
      assertStrictKeys(restoredDetailPayload, ["data"]);
      assertSessionContract(restoredDetailPayload.data, {
        id: hiddenPrivateId,
        project_id: context.projectId,
        creator_id: context.ownerId,
        title: "hidden-private",
        visibility: "shared",
        runtime_status: "idle",
        bound_agent_node_id: context.nodeId,
        bound_agent_session_ref: resharePayload.data.bound_agent_session_ref,
        last_message_at: "2026-04-21T00:02:00.000Z",
        pending_count: 0,
      });

      const restoredList = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${context.projectId}/sessions?limit=10`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(restoredList.statusCode, 200);
      const restoredListPayload = restoredList.json();
      assertCursorEnvelope(restoredListPayload, 3);
      const restoredSession = restoredListPayload.data.find(
        (session) => session.id === hiddenPrivateId,
      );
      assert.ok(restoredSession);
      assertSessionContract(restoredSession, {
        id: hiddenPrivateId,
        project_id: context.projectId,
        creator_id: context.ownerId,
        title: "hidden-private",
        visibility: "shared",
        runtime_status: "idle",
        bound_agent_node_id: context.nodeId,
        bound_agent_session_ref: resharePayload.data.bound_agent_session_ref,
        last_message_at: "2026-04-21T00:02:00.000Z",
        pending_count: 0,
      });
      assert.equal(restoredListPayload.meta.next_cursor, null);
    });
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});
