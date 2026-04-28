import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupPersistedSessionContext,
  createPersistedSessionContext,
  getPool,
  insertMessage,
  closePool,
} from "../helpers/database.mjs";
import { startDevStack, waitForDevServices } from "../helpers/dev-stack.mjs";

async function readJson(response) {
  return response.json();
}

test(
  "e2e_visibility_search_todo enforces shared/private visibility across search, replay, and todos on the running stack",
  { timeout: 70000 },
  async (context) => {
    const backendUrl = "http://127.0.0.1:3001/api/v1";
    const dev = await startDevStack();
    const sessionContext = await createPersistedSessionContext();

    context.after(async () => {
      await cleanupPersistedSessionContext(sessionContext);
      await closePool();
      await dev.stop();
    });

    await waitForDevServices({ timeoutMs: 45000 });

    const sourceMessage = await insertMessage(await getPool(), {
      sessionId: sessionContext.sessionId,
      senderType: "member",
      senderUserId: sessionContext.ownerId,
      content: "visibility-e2e-keyword",
      processingStatus: "completed",
      sequenceNo: 1,
    });

    const createTodo = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/todos`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-syncai-user-id": sessionContext.memberId,
        },
        body: JSON.stringify({
          source_message_id: sourceMessage.id,
          title: "e2e todo item",
        }),
      },
    );

    assert.equal(createTodo.status, 201);

    const searchBefore = await fetch(
      `${backendUrl}/teams/${sessionContext.teamId}/search?q=visibility-e2e-keyword`,
      {
        headers: {
          "x-syncai-user-id": sessionContext.memberId,
        },
      },
    );

    assert.equal(searchBefore.status, 200);
    assert.equal((await readJson(searchBefore)).data.length, 1);

    const replayBefore = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/replay`,
      {
        headers: {
          "x-syncai-user-id": sessionContext.memberId,
        },
      },
    );

    assert.equal(replayBefore.status, 200);

    const todosBefore = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/todos`,
      {
        headers: {
          "x-syncai-user-id": sessionContext.memberId,
        },
      },
    );

    assert.equal(todosBefore.status, 200);
    assert.equal((await readJson(todosBefore)).data.length, 1);

    const privatize = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/visibility`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-syncai-user-id": sessionContext.ownerId,
        },
        body: JSON.stringify({
          visibility: "private",
        }),
      },
    );

    assert.equal(privatize.status, 200);

    const searchHidden = await fetch(
      `${backendUrl}/teams/${sessionContext.teamId}/search?q=visibility-e2e-keyword`,
      {
        headers: {
          "x-syncai-user-id": sessionContext.memberId,
        },
      },
    );

    assert.equal(searchHidden.status, 200);
    assert.deepEqual((await readJson(searchHidden)).data, []);

    const replayHidden = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/replay`,
      {
        headers: {
          "x-syncai-user-id": sessionContext.memberId,
        },
      },
    );

    assert.equal(replayHidden.status, 403);

    const todosHidden = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/todos`,
      {
        headers: {
          "x-syncai-user-id": sessionContext.memberId,
        },
      },
    );

    assert.equal(todosHidden.status, 403);

    const reshare = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/visibility`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-syncai-user-id": sessionContext.ownerId,
        },
        body: JSON.stringify({
          visibility: "shared",
        }),
      },
    );

    assert.equal(reshare.status, 200);

    const searchRestored = await fetch(
      `${backendUrl}/teams/${sessionContext.teamId}/search?q=visibility-e2e-keyword`,
      {
        headers: {
          "x-syncai-user-id": sessionContext.memberId,
        },
      },
    );

    assert.equal(searchRestored.status, 200);
    assert.equal((await readJson(searchRestored)).data.length, 1);

    const replayRestored = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/replay`,
      {
        headers: {
          "x-syncai-user-id": sessionContext.memberId,
        },
      },
    );

    assert.equal(replayRestored.status, 200);

    const todosRestored = await fetch(
      `${backendUrl}/sessions/${sessionContext.sessionId}/todos`,
      {
        headers: {
          "x-syncai-user-id": sessionContext.memberId,
        },
      },
    );

    assert.equal(todosRestored.status, 200);
    assert.equal((await readJson(todosRestored)).data.length, 1);
  },
);
