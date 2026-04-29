import { EventEmitter } from "node:events";
import type { SessionRuntimeStatus } from "@syncai/shared";
import type { Pool } from "pg";
import { createCodexAgentAdapter } from "./codex-agent-adapter.js";
import {
  type MockAgentResult,
  type SendMessageInput,
  type StartSessionInput,
  type StreamEvent,
} from "./mock-agent-adapter.js";
import {
  appendCommandSummaryEvent,
  appendMessageFailedEvent,
  appendStatusChangedEvent,
} from "./session-events.js";

type RuntimeLogger = {
  error: (...args: unknown[]) => void;
};

interface ClaimedMessage {
  sessionId: string;
  messageId: string;
  content: string;
  agentSessionRef: string | undefined;
  runtimeStatus: SessionRuntimeStatus;
}

export interface WorkspaceRuntime {
  ensureSessionBinding(
    input: StartSessionInput,
  ): Promise<{ agentSessionRef: string }>;
  scheduleSession(sessionId: string): void;
  waitForSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
}

export interface WsMessageEvent {
  sessionId: string;
  message: {
    id: string;
    content: string;
    sender: string;
    session_id: string;
    created_at: string;
  };
}

export interface WsStatusEvent {
  sessionId: string;
  runtimeStatus: string;
}

export function createWorkspaceRuntime(options: {
  db: Pool;
  logger: RuntimeLogger;
  mockLatencyMs?: number;
  codexPath?: string;
}): WorkspaceRuntime {
  const adapter = createCodexAgentAdapter(
    options.codexPath !== undefined
      ? { codexPath: options.codexPath }
      : undefined,
  );
  const emitter = new EventEmitter();
  const activeSessions = new Map<string, Promise<void>>();

  async function claimNextMessage(
    sessionId: string,
  ): Promise<ClaimedMessage | null> {
    const client = await options.db.connect();

    try {
      await client.query("BEGIN");

      const sessionResult = await client.query(
        `SELECT runtime_status, bound_agent_session_ref
         FROM sessions
         WHERE id = $1
           AND archived_at IS NULL
         FOR UPDATE`,
        [sessionId],
      );

      const session = sessionResult.rows[0];
      if (!session) {
        await client.query("ROLLBACK");
        return null;
      }

      const messageResult = await client.query(
        `SELECT id, content
         FROM messages
         WHERE session_id = $1
           AND processing_status IN ('accepted', 'queued')
         ORDER BY sequence_no ASC
         LIMIT 1
         FOR UPDATE`,
        [sessionId],
      );

      const message = messageResult.rows[0];
      if (!message) {
        await client.query("COMMIT");
        return null;
      }

      await client.query(
        `UPDATE messages
         SET processing_status = 'running',
             updated_at = now()
         WHERE id = $1`,
        [message.id],
      );

      await client.query(
        `UPDATE sessions
         SET runtime_status = 'running',
             updated_at = now()
         WHERE id = $1`,
        [sessionId],
      );

      if (session.runtime_status !== "running") {
        await appendStatusChangedEvent(client, {
          sessionId,
          relatedMessageId: String(message.id),
          from: session.runtime_status as SessionRuntimeStatus,
          to: "running",
        });
      }

      await client.query("COMMIT");

      return {
        sessionId,
        messageId: String(message.id),
        content: String(message.content),
        agentSessionRef:
          typeof session.bound_agent_session_ref === "string"
            ? String(session.bound_agent_session_ref)
            : undefined,
        runtimeStatus: session.runtime_status as SessionRuntimeStatus,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function finalizeSuccess(
    message: ClaimedMessage,
    result: MockAgentResult,
  ): Promise<boolean> {
    const client = await options.db.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `SELECT runtime_status
         FROM sessions
         WHERE id = $1
           AND archived_at IS NULL
         FOR UPDATE`,
        [message.sessionId],
      );

      await client.query(
        `UPDATE messages
         SET processing_status = 'completed',
             error_summary = NULL,
             updated_at = now()
         WHERE id = $1`,
        [message.messageId],
      );

      const sequenceResult = await client.query(
        `SELECT COALESCE(MAX(sequence_no), 0)::bigint AS last_sequence
         FROM messages
         WHERE session_id = $1`,
        [message.sessionId],
      );
      const nextSequence =
        Number(sequenceResult.rows[0]?.last_sequence ?? 0) + 1;

      const agentMessageResult = await client.query(
        `INSERT INTO messages (
           session_id,
           sender_type,
           sender_user_id,
           content,
           processing_status,
           is_final_reply,
           sequence_no,
           client_message_id,
           error_summary,
           metadata
         )
         VALUES ($1, 'agent', NULL, $2, 'completed', TRUE, $3, NULL, NULL, '{}'::jsonb)
         RETURNING id`,
        [message.sessionId, result.finalReply, nextSequence],
      );

      const agentMessageRow = agentMessageResult.rows[0];
      const agentMessageId = String(agentMessageRow.id);

      await appendCommandSummaryEvent(client, {
        sessionId: message.sessionId,
        messageId: message.messageId,
        summary: result.summary,
        agentMessageId,
      });

      emitter.emit("message.new", {
        sessionId: message.sessionId,
        message: {
          id: agentMessageId,
          content: result.finalReply,
          sender: "agent",
          session_id: message.sessionId,
          created_at: new Date().toISOString(),
        },
      });

      const remainingResult = await client.query(
        `SELECT COUNT(*)::int AS remaining_count
         FROM messages
         WHERE session_id = $1
           AND processing_status IN ('accepted', 'queued')`,
        [message.sessionId],
      );
      const hasQueuedMessages =
        Number(remainingResult.rows[0]?.remaining_count ?? 0) > 0;
      const nextRuntimeStatus: SessionRuntimeStatus = hasQueuedMessages
        ? "queued"
        : "completed";

      await client.query(
        `UPDATE sessions
         SET runtime_status = $2,
             last_message_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [message.sessionId, nextRuntimeStatus],
      );

      await appendStatusChangedEvent(client, {
        sessionId: message.sessionId,
        relatedMessageId: message.messageId,
        from: "running",
        to: nextRuntimeStatus,
      });

      emitter.emit("status.changed", {
        sessionId: message.sessionId,
        runtimeStatus: nextRuntimeStatus,
      });

      await client.query("COMMIT");
      return hasQueuedMessages;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function finalizeFailure(message: ClaimedMessage, error: unknown) {
    const client = await options.db.connect();
    const errorSummary =
      error instanceof Error ? error.message : "Unknown workspace runtime error";

    try {
      await client.query("BEGIN");

      await client.query(
        `SELECT runtime_status
         FROM sessions
         WHERE id = $1
           AND archived_at IS NULL
         FOR UPDATE`,
        [message.sessionId],
      );

      await client.query(
        `UPDATE messages
         SET processing_status = 'failed',
             error_summary = $2,
             updated_at = now()
         WHERE id = $1`,
        [message.messageId, errorSummary],
      );

      await client.query(
        `UPDATE sessions
         SET runtime_status = 'error',
             updated_at = now()
         WHERE id = $1`,
        [message.sessionId],
      );

      await appendStatusChangedEvent(client, {
        sessionId: message.sessionId,
        relatedMessageId: message.messageId,
        from: "running",
        to: "error",
        extraPayload: {
          error_summary: errorSummary,
        },
      });

      await appendMessageFailedEvent(client, {
        sessionId: message.sessionId,
        messageId: message.messageId,
        errorSummary,
      });

      emitter.emit("status.changed", {
        sessionId: message.sessionId,
        runtimeStatus: "error",
      });

      await client.query("COMMIT");
    } catch (commitError) {
      await client.query("ROLLBACK");
      throw commitError;
    } finally {
      client.release();
    }
  }

  async function persistAgentSessionRef(
    sessionId: string,
    agentSessionRef: string,
  ) {
    await options.db.query(
      `UPDATE sessions
       SET bound_agent_session_ref = $2,
           updated_at = now()
       WHERE id = $1
         AND archived_at IS NULL
         AND bound_agent_session_ref <> $2`,
      [sessionId, agentSessionRef],
    );
  }

  async function processSession(sessionId: string) {
    while (true) {
      const message = await claimNextMessage(sessionId);

      if (!message) {
        return;
      }

      try {
        // Resolve working directory from the project linked to this session
        let workingDirectory: string | undefined;
        try {
          const wdResult = await options.db.query(
            `SELECT p.working_directory
             FROM sessions s
             JOIN projects p ON p.id = s.project_id
             WHERE s.id = $1`,
            [message.sessionId],
          );
          workingDirectory = wdResult.rows[0]?.working_directory ?? undefined;
        } catch {
          // Best effort — fall back to adapter default
        }

        let finalText = "";

        const sendInput: SendMessageInput = {
          sessionId: message.sessionId,
          messageId: message.messageId,
          content: message.content,
        };
        if (message.agentSessionRef) {
          sendInput.agentSessionRef = message.agentSessionRef;
        }
        if (workingDirectory) {
          sendInput.workingDirectory = workingDirectory;
        }

        for await (const event of adapter.sendMessage(sendInput)) {
          if (
            event.type === "thread.started" &&
            event.data &&
            typeof event.data === "object" &&
            "thread_id" in event.data
          ) {
            const threadId = String(event.data.thread_id);
            if (threadId && threadId !== message.agentSessionRef) {
              await persistAgentSessionRef(message.sessionId, threadId);
              message.agentSessionRef = threadId;
            }
          }

          emitter.emit("stream.event", {
            sessionId: message.sessionId,
            event,
          });

          // Track agent message text for the final result
          if (
            event.type === "item.completed" &&
            event.data &&
            typeof event.data === "object" &&
            "item" in event.data &&
            event.data.item &&
            typeof event.data.item === "object" &&
            (event.data.item as Record<string, unknown>).type === "agent_message" &&
            "text" in (event.data.item as Record<string, unknown>)
          ) {
            finalText = String(
              (event.data.item as Record<string, unknown>).text,
            );
          }
        }

        const result: MockAgentResult = {
          summary: finalText.slice(0, 160),
          finalReply: finalText || "Codex completed with no output.",
        };

        const hasQueuedMessages = await finalizeSuccess(message, result);
        if (!hasQueuedMessages) {
          return;
        }
      } catch (error) {
        await finalizeFailure(message, error);
        return;
      }
    }
  }

  const runtime: WorkspaceRuntime = {
    async ensureSessionBinding(input: StartSessionInput) {
      return adapter.startSession(input);
    },

    scheduleSession(sessionId: string) {
      if (activeSessions.has(sessionId)) {
        return;
      }

      const task = processSession(sessionId)
        .catch((error) => {
          options.logger.error(
            { error, sessionId },
            "workspace runtime loop aborted",
          );
        })
        .finally(() => {
          if (activeSessions.get(sessionId) === task) {
            activeSessions.delete(sessionId);
          }
        });

      activeSessions.set(sessionId, task);
    },

    async waitForSession(sessionId: string) {
      await (activeSessions.get(sessionId) ?? Promise.resolve());
    },

    async close() {
      await Promise.allSettled([...activeSessions.values()]);
    },

    on(event: string, listener: (...args: any[]) => void) {
      emitter.on(event, listener);
      return runtime;
    },

    off(event: string, listener: (...args: any[]) => void) {
      emitter.off(event, listener);
      return runtime;
    },

    emit(event: string, ...args: any[]): boolean {
      return emitter.emit(event, ...args);
    },
  };

  return runtime;
}
