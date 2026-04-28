import assert from "node:assert/strict";
import test, { after } from "node:test";
import { closePool, getPool } from "../helpers/database.mjs";
import {
  assertStrictKeys,
  assertTeamContract,
  assertTeamMemberContract,
} from "../helpers/http-contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

after(async () => {
  await closePool();
});

async function cleanupMembershipFixtures(created = {}) {
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

async function registerUser(app, payload) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload,
  });

  assert.equal(response.statusCode, 201);
  return response.json().data;
}

test("contract_team_membership lets admins add members, promotes roles, and enforces admin-only node management", async () => {
  const suffix = Date.now();
  const created = {
    teamIds: [],
    userIds: [],
  };

  try {
    await withInjectedApp(async (app) => {
      const admin = await registerUser(app, {
        email: `team-admin-${suffix}@example.com`,
        password: "StrongPass123",
        display_name: "Team Admin",
      });
      const member = await registerUser(app, {
        email: `team-member-${suffix}@example.com`,
        password: "StrongPass123",
        display_name: "Team Member",
      });

      created.userIds.push(admin.user.id, member.user.id);

      const teamResponse = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        headers: {
          authorization: `Bearer ${admin.access_token}`,
        },
        payload: {
          name: "Membership Team",
          slug: `membership-team-${suffix}`,
        },
      });

      assert.equal(teamResponse.statusCode, 201);
      const teamId = teamResponse.json().data.id;
      created.teamIds.push(teamId);

      const addMemberResponse = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/members`,
        headers: {
          authorization: `Bearer ${admin.access_token}`,
        },
        payload: {
          user_id: member.user.id,
          role: "member",
        },
      });

      assert.equal(addMemberResponse.statusCode, 201);
      const addMemberPayload = addMemberResponse.json();
      assertStrictKeys(addMemberPayload, ["data"]);
      assertTeamMemberContract(addMemberPayload.data, {
        team_id: teamId,
        user_id: member.user.id,
        role: "member",
        invited_by: admin.user.id,
      });

      const duplicateAddResponse = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/members`,
        headers: {
          authorization: `Bearer ${admin.access_token}`,
        },
        payload: {
          user_id: member.user.id,
          role: "member",
        },
      });

      assert.equal(duplicateAddResponse.statusCode, 409);
      assert.deepEqual(duplicateAddResponse.json(), {
        code: "TEAM_MEMBER_ALREADY_EXISTS",
      });

      const memberTeamsResponse = await app.inject({
        method: "GET",
        url: "/api/v1/teams",
        headers: {
          authorization: `Bearer ${member.access_token}`,
        },
      });

      assert.equal(memberTeamsResponse.statusCode, 200);
      assert.equal(memberTeamsResponse.json().data.length, 1);
      assertTeamContract(memberTeamsResponse.json().data[0], {
        id: teamId,
        member_role: "member",
      });

      const memberConfigureNodeResponse = await app.inject({
        method: "PUT",
        url: `/api/v1/teams/${teamId}/agent-node`,
        headers: {
          authorization: `Bearer ${member.access_token}`,
        },
        payload: {
          display_name: "Should Fail",
          client_fingerprint: "member-host",
        },
      });

      assert.equal(memberConfigureNodeResponse.statusCode, 403);
      assert.deepEqual(memberConfigureNodeResponse.json(), {
        code: "TEAM_FORBIDDEN",
      });

      const promoteMemberResponse = await app.inject({
        method: "PATCH",
        url: `/api/v1/teams/${teamId}/members/${member.user.id}`,
        headers: {
          authorization: `Bearer ${admin.access_token}`,
        },
        payload: {
          role: "admin",
        },
      });

      assert.equal(promoteMemberResponse.statusCode, 200);
      const promotePayload = promoteMemberResponse.json();
      assertStrictKeys(promotePayload, ["data"]);
      assertTeamMemberContract(promotePayload.data, {
        team_id: teamId,
        user_id: member.user.id,
        role: "admin",
      });

      const memberDetailResponse = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}`,
        headers: {
          authorization: `Bearer ${member.access_token}`,
        },
      });

      assert.equal(memberDetailResponse.statusCode, 200);
      assertTeamContract(memberDetailResponse.json().data, {
        id: teamId,
        member_role: "admin",
      });

      const promotedNodeResponse = await app.inject({
        method: "PUT",
        url: `/api/v1/teams/${teamId}/agent-node`,
        headers: {
          authorization: `Bearer ${member.access_token}`,
        },
        payload: {
          display_name: "Promoted Admin Node",
          client_fingerprint: "promoted-host",
        },
      });

      assert.equal(promotedNodeResponse.statusCode, 200);
      assert.equal(promotedNodeResponse.json().data.owner_user_id, member.user.id);
    });
  } finally {
    await cleanupMembershipFixtures(created);
  }
});
