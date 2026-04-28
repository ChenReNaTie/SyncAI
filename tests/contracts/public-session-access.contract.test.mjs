import assert from "node:assert/strict";
import test, { after } from "node:test";
import { closePool, getPool, insertMessage } from "../helpers/database.mjs";
import {
  assertReplayMessageEntry,
  assertSessionContract,
  assertStrictKeys,
  assertTeamMemberContract,
} from "../helpers/http-contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

after(async () => {
  await closePool();
});

async function cleanupPublicSessionAccess(created = {}) {
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

test("contract_public_session_access lets a joined member read a shared session and replay with bearer auth", async () => {
  const suffix = Date.now();
  const created = {
    teamIds: [],
    userIds: [],
  };

  try {
    await withInjectedApp(async (app) => {
      const ownerRegister = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `public-owner-${suffix}@example.com`,
          password: "StrongPass123",
          display_name: "Public Owner",
        },
      });

      assert.equal(ownerRegister.statusCode, 201);
      const ownerPayload = ownerRegister.json().data;
      const ownerToken = ownerPayload.access_token;
      created.userIds.push(ownerPayload.user.id);

      const memberRegister = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `public-member-${suffix}@example.com`,
          password: "StrongPass123",
          display_name: "Public Member",
        },
      });

      assert.equal(memberRegister.statusCode, 201);
      const memberPayload = memberRegister.json().data;
      const memberToken = memberPayload.access_token;
      created.userIds.push(memberPayload.user.id);

      const createTeam = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: "Public Session Team",
          slug: `public-session-team-${suffix}`,
        },
      });

      assert.equal(createTeam.statusCode, 201);
      const teamId = createTeam.json().data.id;
      created.teamIds.push(teamId);

      const addMember = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: memberPayload.user.id,
          role: "member",
        },
      });

      assert.equal(addMember.statusCode, 201);
      assertStrictKeys(addMember.json(), ["data"]);
      assertTeamMemberContract(addMember.json().data, {
        team_id: teamId,
        user_id: memberPayload.user.id,
        role: "member",
        invited_by: ownerPayload.user.id,
      });

      const configureNode = await app.inject({
        method: "PUT",
        url: `/api/v1/teams/${teamId}/agent-node`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          display_name: "Public Session Node",
          client_fingerprint: "public-session-host",
        },
      });

      assert.equal(configureNode.statusCode, 200);
      const nodeId = configureNode.json().data.id;

      const createProject = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/projects`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: "Public Session Project",
          description: "shared session access",
        },
      });

      assert.equal(createProject.statusCode, 201);
      const projectId = createProject.json().data.id;

      const createSession = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/sessions`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          title: "Shared Session For Member Access",
          visibility: "shared",
        },
      });

      assert.equal(createSession.statusCode, 201);
      const sessionPayload = createSession.json();
      assertStrictKeys(sessionPayload, ["data"]);
      assertSessionContract(sessionPayload.data, {
        project_id: projectId,
        creator_id: ownerPayload.user.id,
        title: "Shared Session For Member Access",
        visibility: "shared",
        bound_agent_node_id: nodeId,
      });
      const sessionId = sessionPayload.data.id;

      const memberMessage = await insertMessage(await getPool(), {
        sessionId,
        senderType: "member",
        senderUserId: ownerPayload.user.id,
        content: "Shared session history",
        processingStatus: "completed",
        sequenceNo: 1,
        createdAt: new Date("2026-04-21T04:00:00.000Z"),
      });

      await insertMessage(await getPool(), {
        sessionId,
        senderType: "agent",
        content: "Shared session final reply",
        processingStatus: "completed",
        isFinalReply: true,
        sequenceNo: 2,
        createdAt: new Date("2026-04-21T04:01:00.000Z"),
      });

      const sessionDetail = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${sessionId}`,
        headers: {
          authorization: `Bearer ${memberToken}`,
        },
      });

      assert.equal(sessionDetail.statusCode, 200);
      assertStrictKeys(sessionDetail.json(), ["data"]);
      assertSessionContract(sessionDetail.json().data, {
        id: sessionId,
        project_id: projectId,
        creator_id: ownerPayload.user.id,
        title: "Shared Session For Member Access",
        visibility: "shared",
        bound_agent_node_id: nodeId,
      });

      const replay = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${sessionId}/replay`,
        headers: {
          authorization: `Bearer ${memberToken}`,
        },
      });

      assert.equal(replay.statusCode, 200);
      const replayPayload = replay.json();
      assertStrictKeys(replayPayload, ["data"]);
      assert.equal(replayPayload.data.length, 2);
      assertReplayMessageEntry(replayPayload.data[0], {
        message_id: memberMessage.id,
        sender_type: "member",
        content: "Shared session history",
      });
      assertReplayMessageEntry(replayPayload.data[1], {
        sender_type: "agent",
        content: "Shared session final reply",
      });
    });
  } finally {
    await cleanupPublicSessionAccess(created);
  }
});

test("contract_public_session_access hides an archived project's shared session from joined members", async () => {
  const suffix = Date.now();
  const created = {
    teamIds: [],
    userIds: [],
  };

  try {
    await withInjectedApp(async (app) => {
      const ownerRegister = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `public-archive-owner-${suffix}@example.com`,
          password: "StrongPass123",
          display_name: "Archive Owner",
        },
      });

      assert.equal(ownerRegister.statusCode, 201);
      const ownerPayload = ownerRegister.json().data;
      const ownerToken = ownerPayload.access_token;
      created.userIds.push(ownerPayload.user.id);

      const memberRegister = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `public-archive-member-${suffix}@example.com`,
          password: "StrongPass123",
          display_name: "Archive Member",
        },
      });

      assert.equal(memberRegister.statusCode, 201);
      const memberPayload = memberRegister.json().data;
      const memberToken = memberPayload.access_token;
      created.userIds.push(memberPayload.user.id);

      const createTeam = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: "Public Archive Team",
          slug: `public-archive-team-${suffix}`,
        },
      });

      assert.equal(createTeam.statusCode, 201);
      const teamId = createTeam.json().data.id;
      created.teamIds.push(teamId);

      const addMember = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: memberPayload.user.id,
          role: "member",
        },
      });

      assert.equal(addMember.statusCode, 201);

      const configureNode = await app.inject({
        method: "PUT",
        url: `/api/v1/teams/${teamId}/agent-node`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          display_name: "Archive Session Node",
          client_fingerprint: "public-archive-host",
        },
      });

      assert.equal(configureNode.statusCode, 200);

      const createProject = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/projects`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: "Public Archive Project",
          description: "archive shared access",
        },
      });

      assert.equal(createProject.statusCode, 201);
      const projectId = createProject.json().data.id;

      const createSession = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/sessions`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          title: "Shared Session Hidden By Archive",
          visibility: "shared",
        },
      });

      assert.equal(createSession.statusCode, 201);
      const sessionId = createSession.json().data.id;

      const archiveProject = await app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${projectId}/archive`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          archived: true,
        },
      });

      assert.equal(archiveProject.statusCode, 200);

      for (const url of [
        `/api/v1/sessions/${sessionId}`,
        `/api/v1/sessions/${sessionId}/replay`,
      ]) {
        const response = await app.inject({
          method: "GET",
          url,
          headers: {
            authorization: `Bearer ${memberToken}`,
          },
        });

        assert.equal(response.statusCode, 404);
        assert.deepEqual(response.json(), {
          code: "SESSION_NOT_FOUND",
        });
      }
    });
  } finally {
    await cleanupPublicSessionAccess(created);
  }
});
