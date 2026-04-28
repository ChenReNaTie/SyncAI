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
  assertAuditLogContract,
  assertSessionContract,
  assertSessionNotVisibleError,
  assertStrictKeys,
  assertTodoContract,
} from "../helpers/http-contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

const group = getDocumentedGroup("contract_todo_and_audit");

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

test(`${group.id} enforces todo visibility with actor-aware creator ids and exposes audit fields`, async () => {
  const context = await createPersistedSessionContext();

  try {
    const sourceMessage = await insertMessage(await getPool(), {
      sessionId: context.sessionId,
      senderType: "member",
      senderUserId: context.ownerId,
      content: "Backfill the automation suite",
      processingStatus: "completed",
      sequenceNo: 1,
    });

    await withInjectedApp(async (app) => {
      const createTodoWithoutActor = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${context.sessionId}/todos`,
        payload: {
          source_message_id: sourceMessage.id,
          title: "missing actor todo",
        },
      });

      assert.equal(createTodoWithoutActor.statusCode, 401);
      assertAuthRequiredError(createTodoWithoutActor.json());

      const createTodo = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${context.sessionId}/todos`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
        payload: {
          source_message_id: sourceMessage.id,
          title: "Backfill the automation suite",
        },
      });

      assert.equal(createTodo.statusCode, 201);
      const createTodoPayload = createTodo.json();
      assertStrictKeys(createTodoPayload, ["data"]);
      assertTodoContract(createTodoPayload.data, {
        session_id: context.sessionId,
        source_message_id: sourceMessage.id,
        title: "Backfill the automation suite",
        status: "pending",
        creator_id: context.memberId,
      });

      const patchTodo = await app.inject({
        method: "PATCH",
        url: `/api/v1/todos/${createTodoPayload.data.id}`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
        payload: {
          status: "completed",
        },
      });

      assert.equal(patchTodo.statusCode, 200);
      const patchTodoPayload = patchTodo.json();
      assertStrictKeys(patchTodoPayload, ["data"]);
      assertTodoContract(patchTodoPayload.data, {
        id: createTodoPayload.data.id,
        session_id: context.sessionId,
        source_message_id: sourceMessage.id,
        title: "Backfill the automation suite",
        status: "completed",
        creator_id: context.memberId,
      });

      const sharedTodos = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/todos`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(sharedTodos.statusCode, 200);
      const sharedTodosPayload = sharedTodos.json();
      assertStrictKeys(sharedTodosPayload, ["data"]);
      assert.equal(sharedTodosPayload.data.length, 1);
      assertTodoContract(sharedTodosPayload.data[0], {
        id: createTodoPayload.data.id,
        session_id: context.sessionId,
        source_message_id: sourceMessage.id,
        title: "Backfill the automation suite",
        status: "completed",
        creator_id: context.memberId,
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

      const hiddenTodos = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/todos`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(hiddenTodos.statusCode, 403);
      assertSessionNotVisibleError(hiddenTodos.json());

      const auditWithoutActor = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/audit-logs`,
      });

      assert.equal(auditWithoutActor.statusCode, 401);
      assertAuthRequiredError(auditWithoutActor.json());

      const auditLogs = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/audit-logs`,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
      });

      assert.equal(auditLogs.statusCode, 200);
      const auditLogsPayload = auditLogs.json();
      assertStrictKeys(auditLogsPayload, ["data"]);
      assert.equal(auditLogsPayload.data.length, 1);
      assertAuditLogContract(auditLogsPayload.data[0], {
        session_id: context.sessionId,
        action_type: "visibility.changed",
        previous_visibility: "shared",
        new_visibility: "private",
        operator_id: context.ownerId,
      });
      assert.deepEqual(
        auditLogsPayload.data[0].visible_scope_snapshot
          .map((member) => member.role)
          .sort(),
        ["admin", "member"],
      );
      assert.deepEqual(
        auditLogsPayload.data[0].visible_scope_snapshot
          .map((member) => member.user_id)
          .sort(),
        [context.ownerId, context.memberId].sort(),
      );

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

      const auditLogsAfterReshare = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/audit-logs`,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
      });

      assert.equal(auditLogsAfterReshare.statusCode, 200);
      const auditLogsAfterResharePayload = auditLogsAfterReshare.json();
      assertStrictKeys(auditLogsAfterResharePayload, ["data"]);
      assert.equal(auditLogsAfterResharePayload.data.length, 2);
      assertAuditLogContract(auditLogsAfterResharePayload.data[0], {
        session_id: context.sessionId,
        action_type: "visibility.changed",
        previous_visibility: "private",
        new_visibility: "shared",
        operator_id: context.ownerId,
        shared_ended_at: null,
      });
      assertAuditLogContract(auditLogsAfterResharePayload.data[1], {
        session_id: context.sessionId,
        action_type: "visibility.changed",
        previous_visibility: "shared",
        new_visibility: "private",
        operator_id: context.ownerId,
      });

      const restoredTodos = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/todos`,
        headers: {
          "x-syncai-user-id": context.memberId,
        },
      });

      assert.equal(restoredTodos.statusCode, 200);
      const restoredTodosPayload = restoredTodos.json();
      assertStrictKeys(restoredTodosPayload, ["data"]);
      assert.equal(restoredTodosPayload.data.length, 1);
      assertTodoContract(restoredTodosPayload.data[0], {
        id: createTodoPayload.data.id,
        session_id: context.sessionId,
        source_message_id: sourceMessage.id,
        title: "Backfill the automation suite",
        status: "completed",
        creator_id: context.memberId,
      });
    });
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});

test(`${group.id} blocks replay, todo, and visibility access after the project is archived`, async () => {
  const context = await createPersistedSessionContext();

  try {
    const sourceMessage = await insertMessage(await getPool(), {
      sessionId: context.sessionId,
      senderType: "member",
      senderUserId: context.ownerId,
      content: "Archive the workspace context",
      processingStatus: "completed",
      sequenceNo: 1,
    });

    await withInjectedApp(async (app) => {
      const createTodo = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${context.sessionId}/todos`,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
        payload: {
          source_message_id: sourceMessage.id,
          title: "Archive boundary todo",
        },
      });

      assert.equal(createTodo.statusCode, 201);
      const todoId = createTodo.json().data.id;

      const replayBeforeArchive = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${context.sessionId}/replay`,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
      });

      assert.equal(replayBeforeArchive.statusCode, 200);
      assertStrictKeys(replayBeforeArchive.json(), ["data"]);

      await archiveProject(context.projectId);

      for (const url of [
        `/api/v1/sessions/${context.sessionId}/replay`,
        `/api/v1/sessions/${context.sessionId}/todos`,
      ]) {
        const response = await app.inject({
          method: "GET",
          url,
          headers: {
            "x-syncai-user-id": context.ownerId,
          },
        });

        assert.equal(response.statusCode, 404);
        assert.deepEqual(response.json(), {
          code: "SESSION_NOT_FOUND",
        });
      }

      const createTodoAfterArchive = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${context.sessionId}/todos`,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
        payload: {
          source_message_id: sourceMessage.id,
          title: "Should stay blocked after archive",
        },
      });

      assert.equal(createTodoAfterArchive.statusCode, 404);
      assert.deepEqual(createTodoAfterArchive.json(), {
        code: "SESSION_NOT_FOUND",
      });

      const patchTodoAfterArchive = await app.inject({
        method: "PATCH",
        url: `/api/v1/todos/${todoId}`,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
        payload: {
          status: "completed",
        },
      });

      assert.equal(patchTodoAfterArchive.statusCode, 404);
      assert.deepEqual(patchTodoAfterArchive.json(), {
        code: "TODO_NOT_FOUND",
      });

      const patchVisibilityAfterArchive = await app.inject({
        method: "PATCH",
        url: `/api/v1/sessions/${context.sessionId}/visibility`,
        headers: {
          "x-syncai-user-id": context.ownerId,
        },
        payload: {
          visibility: "private",
        },
      });

      assert.equal(patchVisibilityAfterArchive.statusCode, 404);
      assert.deepEqual(patchVisibilityAfterArchive.json(), {
        code: "SESSION_NOT_FOUND",
      });
    });
  } finally {
    await cleanupPersistedSessionContext(context);
  }
});
