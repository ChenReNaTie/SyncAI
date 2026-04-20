import type {
  SessionEventType,
  SessionRuntimeStatus,
} from "@syncai/shared";
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

interface AppendSessionEventInput {
  sessionId: string;
  eventType: SessionEventType;
  summary: string;
  payload?: Record<string, unknown>;
  relatedMessageId?: string | null;
  occurredAt?: Date;
}

export async function appendSessionEvent(
  client: Queryable,
  input: AppendSessionEventInput,
) {
  await client.query(
    `INSERT INTO session_events (
       session_id,
       related_message_id,
       event_type,
       summary,
       payload,
       occurred_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      input.sessionId,
      input.relatedMessageId ?? null,
      input.eventType,
      input.summary,
      JSON.stringify(input.payload ?? {}),
      input.occurredAt ?? new Date(),
    ],
  );
}

function buildStatusChangedSummary(
  from: SessionRuntimeStatus,
  to: SessionRuntimeStatus,
) {
  if (from === to) {
    return `Session runtime remained ${to}`;
  }

  if (to === "queued") {
    return from === "running"
      ? "Session finished the current message and returned to queue"
      : "Session accepted a new message and entered the queue";
  }

  if (to === "running") {
    return "Session started processing the next queued message";
  }

  if (to === "completed") {
    return "Session completed the latest member message";
  }

  if (to === "error") {
    return "Session execution failed";
  }

  return `Session runtime changed from ${from} to ${to}`;
}

export async function appendStatusChangedEvent(
  client: Queryable,
  input: {
    sessionId: string;
    from: SessionRuntimeStatus;
    to: SessionRuntimeStatus;
    relatedMessageId?: string | null;
    summary?: string;
    extraPayload?: Record<string, unknown>;
    occurredAt?: Date;
  },
) {
  const event: AppendSessionEventInput = {
    sessionId: input.sessionId,
    eventType: "status.changed",
    summary:
      input.summary ?? buildStatusChangedSummary(input.from, input.to),
    payload: {
      from: input.from,
      to: input.to,
      ...(input.extraPayload ?? {}),
    },
  };

  if (input.relatedMessageId !== undefined) {
    event.relatedMessageId = input.relatedMessageId;
  }

  if (input.occurredAt !== undefined) {
    event.occurredAt = input.occurredAt;
  }

  await appendSessionEvent(client, event);
}

export async function appendMessageQueuedEvent(
  client: Queryable,
  input: {
    sessionId: string;
    messageId: string;
    queuePosition: number;
    occurredAt?: Date;
  },
) {
  const event: AppendSessionEventInput = {
    sessionId: input.sessionId,
    eventType: "message.queued",
    relatedMessageId: input.messageId,
    summary: "Member message queued for later execution",
    payload: {
      message_id: input.messageId,
      queue_position: input.queuePosition,
    },
  };

  if (input.occurredAt !== undefined) {
    event.occurredAt = input.occurredAt;
  }

  await appendSessionEvent(client, event);
}

export async function appendCommandSummaryEvent(
  client: Queryable,
  input: {
    sessionId: string;
    messageId: string;
    summary: string;
    agentMessageId?: string | null;
    occurredAt?: Date;
  },
) {
  const event: AppendSessionEventInput = {
    sessionId: input.sessionId,
    eventType: "command.summary",
    relatedMessageId: input.messageId,
    summary: input.summary,
    payload: {
      message_id: input.messageId,
      agent_message_id: input.agentMessageId ?? null,
    },
  };

  if (input.occurredAt !== undefined) {
    event.occurredAt = input.occurredAt;
  }

  await appendSessionEvent(client, event);
}

export async function appendMessageFailedEvent(
  client: Queryable,
  input: {
    sessionId: string;
    messageId: string;
    errorSummary: string;
    occurredAt?: Date;
  },
) {
  const event: AppendSessionEventInput = {
    sessionId: input.sessionId,
    eventType: "message.failed",
    relatedMessageId: input.messageId,
    summary: input.errorSummary,
    payload: {
      message_id: input.messageId,
      error_summary: input.errorSummary,
    },
  };

  if (input.occurredAt !== undefined) {
    event.occurredAt = input.occurredAt;
  }

  await appendSessionEvent(client, event);
}
