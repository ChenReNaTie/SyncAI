import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  closePool,
  insertMessage,
  seedSessionContext,
  withRollbackTransaction,
} from "../helpers/database.mjs";

after(async () => {
  await closePool();
});

test("integration_execution_records indexes only member messages and final agent replies for search", async () => {
  await withRollbackTransaction(async (client) => {
    const context = await seedSessionContext(client);

    await insertMessage(client, {
      sessionId: context.sessionId,
      senderType: "member",
      senderUserId: context.ownerId,
      content: "queue visibility problem",
      processingStatus: "completed",
      sequenceNo: 1,
      clientMessageId: "member-001",
    });

    await insertMessage(client, {
      sessionId: context.sessionId,
      senderType: "agent",
      content: "intermediate command summary",
      processingStatus: "running",
      isFinalReply: false,
      sequenceNo: 2,
      clientMessageId: "agent-001",
    });

    await insertMessage(client, {
      sessionId: context.sessionId,
      senderType: "agent",
      content: "final reply with queue fix",
      processingStatus: "completed",
      isFinalReply: true,
      sequenceNo: 3,
      clientMessageId: "agent-002",
    });

    const result = await client.query(
      `SELECT sender_type, is_final_reply, search_vector IS NOT NULL AS indexed
       FROM messages
       WHERE session_id = $1
       ORDER BY sequence_no`,
      [context.sessionId],
    );

    assert.deepEqual(
      result.rows.map((row) => ({
        senderType: row.sender_type,
        isFinalReply: row.is_final_reply,
        indexed: row.indexed,
      })),
      [
        { senderType: "member", isFinalReply: false, indexed: true },
        { senderType: "agent", isFinalReply: false, indexed: false },
        { senderType: "agent", isFinalReply: true, indexed: true },
      ],
    );
  });
});

test("integration_execution_records keeps replay events in session_events instead of the searchable message layer", async () => {
  await withRollbackTransaction(async (client) => {
    const context = await seedSessionContext(client);

    await client.query(
      `INSERT INTO session_events (session_id, event_type, summary, payload, occurred_at)
       VALUES
       ($1, 'command.summary', $2, '{}'::jsonb, now()),
       ($1, 'session.privatized', $3, '{}'::jsonb, now())`,
      [
        context.sessionId,
        "Applied the command summary",
        "Session visibility changed to private",
      ],
    );

    const events = await client.query(
      `SELECT event_type
       FROM session_events
       WHERE session_id = $1
       ORDER BY event_type`,
      [context.sessionId],
    );

    assert.deepEqual(
      events.rows.map((row) => row.event_type),
      ["command.summary", "session.privatized"],
    );

    const searchableMessages = await client.query(
      `SELECT count(*)::int AS count
       FROM messages
       WHERE session_id = $1
         AND search_vector IS NOT NULL`,
      [context.sessionId],
    );

    assert.equal(searchableMessages.rows[0].count, 0);
  });
});
