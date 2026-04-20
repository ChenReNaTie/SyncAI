import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  closePool,
  insertMessage,
  listEnumValues,
  seedSessionContext,
  withRollbackTransaction,
} from "../helpers/database.mjs";

after(async () => {
  await closePool();
});

test("integration_dispatch_queue reserves the full message processing enum required by queueing", async () => {
  await withRollbackTransaction(async (client) => {
    const values = await listEnumValues(client, "message_processing_status");

    assert.deepEqual(values, [
      "accepted",
      "queued",
      "running",
      "completed",
      "failed",
    ]);
  });
});

test("integration_dispatch_queue enforces client_message_id uniqueness per session for idempotency", async () => {
  await withRollbackTransaction(async (client) => {
    const primaryContext = await seedSessionContext(client);
    const secondaryContext = await seedSessionContext(client, {
      title: "second-session",
    });

    await insertMessage(client, {
      sessionId: primaryContext.sessionId,
      senderType: "member",
      senderUserId: primaryContext.ownerId,
      content: "First queued request",
      processingStatus: "accepted",
      sequenceNo: 1,
      clientMessageId: "msg-001",
    });

    await client.query("SAVEPOINT duplicate_message");

    await assert.rejects(
      insertMessage(client, {
        sessionId: primaryContext.sessionId,
        senderType: "member",
        senderUserId: primaryContext.ownerId,
        content: "Duplicate client id",
        processingStatus: "queued",
        sequenceNo: 2,
        clientMessageId: "msg-001",
      }),
      (error) => error?.code === "23505",
    );

    await client.query("ROLLBACK TO SAVEPOINT duplicate_message");
    await client.query("RELEASE SAVEPOINT duplicate_message");

    const duplicateAcrossSessions = await insertMessage(client, {
      sessionId: secondaryContext.sessionId,
      senderType: "member",
      senderUserId: secondaryContext.ownerId,
      content: "Same client id in another session",
      processingStatus: "accepted",
      sequenceNo: 1,
      clientMessageId: "msg-001",
    });

    assert.equal(duplicateAcrossSessions.client_message_id, "msg-001");
  });
});
