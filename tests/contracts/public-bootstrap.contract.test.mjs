import assert from "node:assert/strict";
import test, { after } from "node:test";
import { closePool, getPool } from "../helpers/database.mjs";
import {
  assertAgentNodeContract,
  assertAuthRequiredError,
  assertProjectContract,
  assertSessionContract,
  assertStrictKeys,
  assertTeamContract,
} from "../helpers/http-contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

after(async () => {
  await closePool();
});

async function cleanupPublicBootstrap(created = {}) {
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

test("contract_public_bootstrap creates team, configures agent node, creates project, and opens the first session through public APIs", async () => {
  const email = `bootstrap-${Date.now()}@example.com`;
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
          email,
          password: "StrongPass123",
          display_name: "Bootstrap Admin",
        },
      });

      assert.equal(registerResponse.statusCode, 201);
      const registerPayload = registerResponse.json();
      const accessToken = registerPayload.data.access_token;
      created.userIds.push(registerPayload.data.user.id);

      const createTeamResponse = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          name: "Bootstrap Team",
          slug: `bootstrap-team-${Date.now()}`,
        },
      });

      assert.equal(createTeamResponse.statusCode, 201);
      const createTeamPayload = createTeamResponse.json();
      assertStrictKeys(createTeamPayload, ["data"]);
      assertTeamContract(createTeamPayload.data, {
        created_by: registerPayload.data.user.id,
        member_role: "admin",
        name: "Bootstrap Team",
      });
      created.teamIds.push(createTeamPayload.data.id);

      const listTeamsResponse = await app.inject({
        method: "GET",
        url: "/api/v1/teams",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(listTeamsResponse.statusCode, 200);
      const listTeamsPayload = listTeamsResponse.json();
      assertStrictKeys(listTeamsPayload, ["data"]);
      assert.equal(listTeamsPayload.data.length, 1);
      assertTeamContract(listTeamsPayload.data[0], {
        id: createTeamPayload.data.id,
      });

      const teamDetailResponse = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${createTeamPayload.data.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(teamDetailResponse.statusCode, 200);
      assertTeamContract(teamDetailResponse.json().data, {
        id: createTeamPayload.data.id,
      });

      const configureNodeResponse = await app.inject({
        method: "PUT",
        url: `/api/v1/teams/${createTeamPayload.data.id}/agent-node`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          display_name: "Admin MacBook",
          client_fingerprint: "host-001",
        },
      });

      assert.equal(configureNodeResponse.statusCode, 200);
      const configureNodePayload = configureNodeResponse.json();
      assertStrictKeys(configureNodePayload, ["data"]);
      assertAgentNodeContract(configureNodePayload.data, {
        team_id: createTeamPayload.data.id,
        owner_user_id: registerPayload.data.user.id,
        display_name: "Admin MacBook",
        client_fingerprint: "host-001",
        connection_status: "online",
      });

      const getNodeResponse = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${createTeamPayload.data.id}/agent-node`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(getNodeResponse.statusCode, 200);
      assertAgentNodeContract(getNodeResponse.json().data, {
        id: configureNodePayload.data.id,
      });

      const createProjectResponse = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${createTeamPayload.data.id}/projects`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          name: "shared-ai-chat",
          description: "Public bootstrap flow",
          working_directory: "C:\\workspace\\shared-ai-chat",
        },
      });

      assert.equal(createProjectResponse.statusCode, 201);
      const createProjectPayload = createProjectResponse.json();
      assertStrictKeys(createProjectPayload, ["data"]);
      assertProjectContract(createProjectPayload.data, {
        team_id: createTeamPayload.data.id,
        created_by: registerPayload.data.user.id,
        name: "shared-ai-chat",
        description: "Public bootstrap flow",
        working_directory: "C:\\workspace\\shared-ai-chat",
      });

      const listProjectsResponse = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${createTeamPayload.data.id}/projects`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(listProjectsResponse.statusCode, 200);
      const listProjectsPayload = listProjectsResponse.json();
      assertStrictKeys(listProjectsPayload, ["data"]);
      assert.equal(listProjectsPayload.data.length, 1);
      assertProjectContract(listProjectsPayload.data[0], {
        id: createProjectPayload.data.id,
        working_directory: "C:\\workspace\\shared-ai-chat",
      });

      const projectDetailResponse = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${createProjectPayload.data.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(projectDetailResponse.statusCode, 200);
      assertStrictKeys(projectDetailResponse.json(), ["data"]);
      assertProjectContract(projectDetailResponse.json().data, {
        id: createProjectPayload.data.id,
        team_id: createTeamPayload.data.id,
        working_directory: "C:\\workspace\\shared-ai-chat",
      });

      const createSessionResponse = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${createProjectPayload.data.id}/sessions`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          title: "First public bootstrap session",
          visibility: "shared",
        },
      });

      assert.equal(createSessionResponse.statusCode, 201);
      const createSessionPayload = createSessionResponse.json();
      assertStrictKeys(createSessionPayload, ["data"]);
      assertSessionContract(createSessionPayload.data, {
        project_id: createProjectPayload.data.id,
        creator_id: registerPayload.data.user.id,
        title: "First public bootstrap session",
        visibility: "shared",
        runtime_status: "idle",
        pending_count: 0,
        bound_agent_node_id: configureNodePayload.data.id,
      });
    });
  } finally {
    await cleanupPublicBootstrap(created);
  }
});

test("contract_public_bootstrap requires auth, surfaces missing-node state, and rejects duplicate team slugs", async () => {
  const email = `bootstrap-guard-${Date.now()}@example.com`;
  const created = {
    teamIds: [],
    userIds: [],
  };

  try {
    await withInjectedApp(async (app) => {
      const unauthenticatedCreateTeam = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        payload: {
          name: "Unauthorized Team",
          slug: `unauthorized-team-${Date.now()}`,
        },
      });

      assert.equal(unauthenticatedCreateTeam.statusCode, 401);
      assertAuthRequiredError(unauthenticatedCreateTeam.json());

      const registerResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email,
          password: "StrongPass123",
          display_name: "Guard Admin",
        },
      });

      assert.equal(registerResponse.statusCode, 201);
      const registerPayload = registerResponse.json();
      const accessToken = registerPayload.data.access_token;
      created.userIds.push(registerPayload.data.user.id);

      const slug = `guard-team-${Date.now()}`;
      const createTeamResponse = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          name: "Guard Team",
          slug,
        },
      });

      assert.equal(createTeamResponse.statusCode, 201);
      const teamId = createTeamResponse.json().data.id;
      created.teamIds.push(teamId);

      const duplicateTeamResponse = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          name: "Guard Team Duplicate",
          slug,
        },
      });

      assert.equal(duplicateTeamResponse.statusCode, 409);
      assert.deepEqual(duplicateTeamResponse.json(), {
        code: "TEAM_SLUG_ALREADY_EXISTS",
      });

      const missingNodeResponse = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}/agent-node`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(missingNodeResponse.statusCode, 404);
      assert.deepEqual(missingNodeResponse.json(), {
        code: "NODE_NOT_CONFIGURED",
      });
    });
  } finally {
    await cleanupPublicBootstrap(created);
  }
});
