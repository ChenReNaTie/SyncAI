import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  closePool,
  getPool,
  insertMessage,
} from "../helpers/database.mjs";
import {
  assertCursorEnvelope,
  assertMessageContract,
  assertProjectContract,
  assertStrictKeys,
  assertTodoContract,
} from "../helpers/http-contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

after(async () => {
  await closePool();
});

async function cleanupArchiveFixtures(created = {}) {
  if (created.teamIds?.length) {
    await getPool().query(
      `DELETE FROM projects
       WHERE team_id = ANY($1::uuid[])`,
      [created.teamIds],
    );
    await getPool().query(
      `DELETE FROM team_agent_nodes
       WHERE team_id = ANY($1::uuid[])`,
      [created.teamIds],
    );
    await getPool().query(
      `DELETE FROM teams
       WHERE id = ANY($1::uuid[])`,
      [created.teamIds],
    );
  }

  if (created.userIds?.length) {
    await getPool().query(
      `DELETE FROM users
       WHERE id = ANY($1::uuid[])`,
      [created.userIds],
    );
  }
}

test("contract_project_archive removes archived projects from active listings and blocks new sessions on them", async () => {
  const suffix = Date.now();
  const created = {
    teamIds: [],
    userIds: [],
  };

  try {
    await withInjectedApp(async (app) => {
      const registerResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `archive-admin-${suffix}@example.com`,
          password: "StrongPass123",
          display_name: "Archive Admin",
        },
      });

      assert.equal(registerResponse.statusCode, 201);
      const registerPayload = registerResponse.json().data;
      created.userIds.push(registerPayload.user.id);

      const teamResponse = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          name: "Archive Team",
          slug: `archive-team-${suffix}`,
        },
      });

      assert.equal(teamResponse.statusCode, 201);
      const teamId = teamResponse.json().data.id;
      created.teamIds.push(teamId);

      const nodeResponse = await app.inject({
        method: "PUT",
        url: `/api/v1/teams/${teamId}/agent-node`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          display_name: "Archive Node",
          client_fingerprint: "archive-host",
        },
      });

      assert.equal(nodeResponse.statusCode, 200);

      const projectResponse = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/projects`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          name: "Archive Project",
          description: "archive me",
        },
      });

      assert.equal(projectResponse.statusCode, 201);
      const projectId = projectResponse.json().data.id;

      const archiveResponse = await app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${projectId}/archive`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          archived: true,
        },
      });

      assert.equal(archiveResponse.statusCode, 200);
      const archivePayload = archiveResponse.json();
      assertStrictKeys(archivePayload, ["data"]);
      assertProjectContract(archivePayload.data, {
        id: projectId,
        team_id: teamId,
        name: "Archive Project",
        description: "archive me",
      });
      assert.ok(archivePayload.data.archived_at);

      const activeProjectsResponse = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}/projects`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
      });

      assert.equal(activeProjectsResponse.statusCode, 200);
      assert.deepEqual(activeProjectsResponse.json(), {
        data: [],
      });

      const createSessionResponse = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/sessions`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          title: "session on archived project",
          visibility: "shared",
        },
      });

      assert.equal(createSessionResponse.statusCode, 404);
      assert.deepEqual(createSessionResponse.json(), {
        code: "PROJECT_NOT_FOUND",
      });
    });
  } finally {
    await cleanupArchiveFixtures(created);
  }
});

test("contract_project_archive hides archived-project sessions from detail, message submission, visibility, audit logs, replay, todos, and search", async () => {
  const suffix = Date.now();
  const created = {
    teamIds: [],
    userIds: [],
  };

  try {
    await withInjectedApp(async (app) => {
      const registerResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `archive-scope-${suffix}@example.com`,
          password: "StrongPass123",
          display_name: "Archive Scope Admin",
        },
      });

      assert.equal(registerResponse.statusCode, 201);
      const registerPayload = registerResponse.json().data;
      created.userIds.push(registerPayload.user.id);

      const teamResponse = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          name: "Archive Scope Team",
          slug: `archive-scope-team-${suffix}`,
        },
      });

      assert.equal(teamResponse.statusCode, 201);
      const teamId = teamResponse.json().data.id;
      created.teamIds.push(teamId);

      const nodeResponse = await app.inject({
        method: "PUT",
        url: `/api/v1/teams/${teamId}/agent-node`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          display_name: "Archive Scope Node",
          client_fingerprint: "archive-scope-host",
        },
      });

      assert.equal(nodeResponse.statusCode, 200);

      const projectResponse = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/projects`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          name: "Archive Scope Project",
          description: "archive scope checks",
        },
      });

      assert.equal(projectResponse.statusCode, 201);
      const projectId = projectResponse.json().data.id;

      const sessionResponse = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/sessions`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          title: "Archive Scope Session",
          visibility: "shared",
        },
      });

      assert.equal(sessionResponse.statusCode, 201);
      const sessionId = sessionResponse.json().data.id;

      const sourceMessage = await insertMessage(await getPool(), {
        sessionId,
        senderType: "member",
        senderUserId: registerPayload.user.id,
        content: "archive-scope-keyword",
        processingStatus: "completed",
        sequenceNo: 1,
      });

      const createTodoResponse = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/todos`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          source_message_id: sourceMessage.id,
          title: "Archive scope todo",
        },
      });

      assert.equal(createTodoResponse.statusCode, 201);
      const todoId = createTodoResponse.json().data.id;

      const detailBeforeArchive = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${sessionId}`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
      });

      assert.equal(detailBeforeArchive.statusCode, 200);

      const messagesBeforeArchive = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${sessionId}/messages`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
      });

      assert.equal(messagesBeforeArchive.statusCode, 200);
      assertStrictKeys(messagesBeforeArchive.json(), ["data"]);
      assert.equal(messagesBeforeArchive.json().data.length, 1);
      assertMessageContract(messagesBeforeArchive.json().data[0], {
        id: sourceMessage.id,
        session_id: sessionId,
        sender_type: "member",
        sender_user_id: registerPayload.user.id,
        content: "archive-scope-keyword",
      });

      const replayBeforeArchive = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${sessionId}/replay`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
      });

      assert.equal(replayBeforeArchive.statusCode, 200);

      const auditLogsBeforeArchive = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${sessionId}/audit-logs`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
      });

      assert.equal(auditLogsBeforeArchive.statusCode, 200);
      assert.deepEqual(auditLogsBeforeArchive.json(), {
        data: [],
      });

      const todosBeforeArchive = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${sessionId}/todos`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
      });

      assert.equal(todosBeforeArchive.statusCode, 200);
      assertStrictKeys(todosBeforeArchive.json(), ["data"]);
      assert.equal(todosBeforeArchive.json().data.length, 1);
      assertTodoContract(todosBeforeArchive.json().data[0], {
        id: todoId,
        session_id: sessionId,
        source_message_id: sourceMessage.id,
        title: "Archive scope todo",
        status: "pending",
        creator_id: registerPayload.user.id,
      });

      const searchBeforeArchive = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}/search?q=archive-scope-keyword`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
      });

      assert.equal(searchBeforeArchive.statusCode, 200);
      const searchBeforeArchivePayload = searchBeforeArchive.json();
      assertCursorEnvelope(searchBeforeArchivePayload, 1);
      const searchBeforeArchiveHits = searchBeforeArchivePayload.data.map(
        (entry) => ({
          project_id: entry.project_id,
          session_id: entry.session_id,
        }),
      );
      assert.deepEqual(searchBeforeArchiveHits, [
        {
          project_id: projectId,
          session_id: sessionId,
        },
      ]);

      const archiveResponse = await app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${projectId}/archive`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          archived: true,
        },
      });

      assert.equal(archiveResponse.statusCode, 200);

      for (const url of [
        `/api/v1/sessions/${sessionId}`,
        `/api/v1/sessions/${sessionId}/messages`,
        `/api/v1/sessions/${sessionId}/audit-logs`,
        `/api/v1/sessions/${sessionId}/replay`,
        `/api/v1/sessions/${sessionId}/todos`,
      ]) {
        const response = await app.inject({
          method: "GET",
          url,
          headers: {
            authorization: `Bearer ${registerPayload.access_token}`,
          },
        });

        assert.equal(response.statusCode, 404);
        assert.deepEqual(response.json(), {
          code: "SESSION_NOT_FOUND",
        });
      }

      const submitMessageAfterArchive = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/messages`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          content: "archive should block message submission",
        },
      });

      assert.equal(submitMessageAfterArchive.statusCode, 404);
      assert.deepEqual(submitMessageAfterArchive.json(), {
        code: "SESSION_NOT_FOUND",
      });

      const createTodoAfterArchive = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/todos`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          source_message_id: sourceMessage.id,
          title: "archive should block todo creation",
        },
      });

      assert.equal(createTodoAfterArchive.statusCode, 404);
      assert.deepEqual(createTodoAfterArchive.json(), {
        code: "SESSION_NOT_FOUND",
      });

      const changeVisibilityAfterArchive = await app.inject({
        method: "PATCH",
        url: `/api/v1/sessions/${sessionId}/visibility`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          visibility: "private",
        },
      });

      assert.equal(changeVisibilityAfterArchive.statusCode, 404);
      assert.deepEqual(changeVisibilityAfterArchive.json(), {
        code: "SESSION_NOT_FOUND",
      });

      const updateTodoAfterArchive = await app.inject({
        method: "PATCH",
        url: `/api/v1/todos/${todoId}`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
        payload: {
          status: "completed",
        },
      });

      assert.equal(updateTodoAfterArchive.statusCode, 404);
      assert.deepEqual(updateTodoAfterArchive.json(), {
        code: "TODO_NOT_FOUND",
      });

      const searchAfterArchive = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}/search?q=archive-scope-keyword`,
        headers: {
          authorization: `Bearer ${registerPayload.access_token}`,
        },
      });

      assert.equal(searchAfterArchive.statusCode, 200);
      const searchAfterArchivePayload = searchAfterArchive.json();
      assertCursorEnvelope(searchAfterArchivePayload, 0);
      const searchAfterArchiveHits = searchAfterArchivePayload.data.map(
        (entry) => ({
          project_id: entry.project_id,
          session_id: entry.session_id,
        }),
      );
      assert.notDeepEqual(searchAfterArchiveHits, searchBeforeArchiveHits);
      assert.equal(
        searchAfterArchiveHits.some(
          (entry) =>
            entry.project_id === projectId || entry.session_id === sessionId,
        ),
        false,
      );
      assert.deepEqual(searchAfterArchivePayload.data, []);
      assert.equal(searchAfterArchivePayload.meta.next_cursor, null);
    });
  } finally {
    await cleanupArchiveFixtures(created);
  }
});
