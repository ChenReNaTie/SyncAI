import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  cleanupPersistedSessionContext,
  closePool,
  createPersistedSessionContext,
  getPool,
  insertMessage,
} from "../helpers/database.mjs";
import { startDevStack, waitForDevServices } from "../helpers/dev-stack.mjs";

async function readJson(response) {
  return response.json();
}

test(
  "e2e_shared_collaboration lets a newly joined team member read shared session history and replay",
  { timeout: 70000 },
  async (context) => {
    const backendUrl = "http://127.0.0.1:3001/api/v1";
    const dev = await startDevStack();
    const sessionContext = await createPersistedSessionContext();
    let lateMemberId;

    context.after(async () => {
      await cleanupPersistedSessionContext(sessionContext, {
        extraUserIds: lateMemberId ? [lateMemberId] : [],
      });
      await closePool();
      await dev.stop();
    });

    await waitForDevServices({ timeoutMs: 45000 });

    const sourceMessage = await insertMessage(await getPool(), {
      sessionId: sessionContext.sessionId,
      senderType: "member",
      senderUserId: sessionContext.ownerId,
      content: "shared-history-keyword",
      processingStatus: "completed",
      sequenceNo: 1,
    });

    const lateMemberResult = await getPool().query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, 'hash', 'Late Member')
       RETURNING id`,
      [`late-member-${randomUUID()}@example.com`],
    );
    lateMemberId = lateMemberResult.rows[0].id;

    await getPool().query(
      `INSERT INTO team_members (team_id, user_id, role, invited_by)
       VALUES ($1, $2, 'member', $3)`,
      [sessionContext.teamId, lateMemberId, sessionContext.ownerId],
    );

    const listResponse = await fetch(
      `${backendUrl}/projects/${sessionContext.projectId}/sessions?limit=10`,
      {
        headers: {
          "x-syncai-user-id": lateMemberId,
        },
      },
    );

    assert.equal(listResponse.status, 200);
    assert.ok(
      (await readJson(listResponse)).data.some(
        (session) => session.id === sessionContext.sessionId,
      ),
    );

    const detailResponse = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}`,
      {
        headers: {
          "x-syncai-user-id": lateMemberId,
        },
      },
    );

    assert.equal(detailResponse.status, 200);
    assert.equal((await readJson(detailResponse)).data.id, sessionContext.sessionId);

    const messagesResponse = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/messages`,
      {
        headers: {
          "x-syncai-user-id": lateMemberId,
        },
      },
    );

    assert.equal(messagesResponse.status, 200);
    assert.ok(
      (await readJson(messagesResponse)).data.some(
        (message) =>
          message.id === sourceMessage.id &&
          message.content === "shared-history-keyword",
      ),
    );

    const replayResponse = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/replay`,
      {
        headers: {
          "x-syncai-user-id": lateMemberId,
        },
      },
    );

    assert.equal(replayResponse.status, 200);
    assert.ok(
      (await readJson(replayResponse)).data.some(
        (entry) =>
          entry.entry_type === "message" &&
          entry.message_id === sourceMessage.id &&
          entry.content === "shared-history-keyword",
      ),
    );
  },
);
