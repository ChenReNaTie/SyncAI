import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  AGENT_TYPE,
  sessionVisibilityValues,
  todoStatusValues,
} from "@syncai/shared";
import { z } from "zod";
import {
  appendMessageQueuedEvent,
  appendStatusChangedEvent,
} from "../lib/session-events.js";

const sessionCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  visibility: z.enum(sessionVisibilityValues),
});

const sessionListQuerySchema = z.object({
  visibility: z.enum(sessionVisibilityValues).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const visibilityPatchSchema = z.object({
  visibility: z.enum(sessionVisibilityValues),
});

const messageCreateSchema = z.object({
  content: z.string().trim().min(1),
  client_message_id: z.string().trim().min(1).max(100).optional(),
});

const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
  project_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const todoCreateSchema = z.object({
  source_message_id: z.string().uuid(),
  title: z.string().trim().min(1).max(255),
});

const todoPatchSchema = z.object({
  status: z.enum(todoStatusValues),
});

function asIso(value: unknown) {
  if (!value) {
    return null;
  }

  return new Date(String(value)).toISOString();
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    code: "INVALID_REQUEST",
    details: error.flatten(),
  });
}

function serializeSession(row: Record<string, unknown>) {
  return {
    id: row.id,
    project_id: row.project_id,
    creator_id: row.creator_id,
    title: row.title,
    visibility: row.visibility,
    runtime_status: row.runtime_status,
    bound_agent_type: row.bound_agent_type,
    bound_agent_node_id: row.bound_agent_node_id,
    bound_agent_session_ref: row.bound_agent_session_ref,
    last_message_at: asIso(row.last_message_at),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    pending_count: Number(row.pending_count ?? 0),
  };
}

function serializeMessage(row: Record<string, unknown>) {
  return {
    id: row.id,
    session_id: row.session_id,
    sender_type: row.sender_type,
    sender_user_id: row.sender_user_id,
    content: row.content,
    processing_status: row.processing_status,
    is_final_reply: Boolean(row.is_final_reply),
    client_message_id: row.client_message_id,
    error_summary: row.error_summary,
    metadata: row.metadata ?? {},
    created_at: asIso(row.created_at),
  };
}

function serializeTodo(row: Record<string, unknown>) {
  return {
    id: row.id,
    session_id: row.session_id,
    source_message_id: row.source_message_id,
    title: row.title,
    status: row.status,
    creator_id: row.creator_id,
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function serializeAuditLog(row: Record<string, unknown>) {
  return {
    id: row.id,
    session_id: row.session_id,
    action_type: row.action_type,
    previous_visibility: row.previous_visibility,
    new_visibility: row.new_visibility,
    visible_scope_snapshot: row.visible_scope_snapshot ?? [],
    shared_started_at: asIso(row.shared_started_at),
    shared_ended_at: asIso(row.shared_ended_at),
    operator_id: row.operator_id,
    created_at: asIso(row.created_at),
  };
}

async function loadSessionDetail(app: FastifyInstance, sessionId: string) {
  const result = await app.db.query(
    `SELECT
       s.id,
       s.project_id,
       s.creator_id,
       s.title,
       s.visibility,
       s.runtime_status,
       s.bound_agent_type,
       s.bound_agent_node_id,
       s.bound_agent_session_ref,
       s.last_message_at,
       s.created_at,
       s.updated_at,
       COUNT(*) FILTER (
         WHERE m.processing_status IN ('accepted', 'queued', 'running')
       )::int AS pending_count
     FROM sessions s
     LEFT JOIN messages m ON m.session_id = s.id
     WHERE s.id = $1
       AND s.archived_at IS NULL
     GROUP BY s.id`,
    [sessionId],
  );

  return result.rows[0];
}

async function loadProjectContext(app: FastifyInstance, projectId: string) {
  const result = await app.db.query(
    `SELECT
       p.id,
       p.team_id,
       p.created_by,
       EXISTS(
         SELECT 1
         FROM team_agent_nodes candidate
         WHERE candidate.team_id = p.team_id
       ) AS has_nodes,
       (
         SELECT candidate.id
         FROM team_agent_nodes candidate
         WHERE candidate.team_id = p.team_id
           AND candidate.connection_status = 'online'
         ORDER BY candidate.updated_at DESC, candidate.created_at DESC
         LIMIT 1
       ) AS online_node_id
     FROM projects p
     WHERE p.id = $1
       AND p.archived_at IS NULL`,
    [projectId],
  );

  return result.rows[0];
}

async function loadSessionContext(app: FastifyInstance, sessionId: string) {
  const result = await app.db.query(
    `SELECT
       s.id,
       s.project_id,
       s.creator_id,
       s.title,
       s.visibility,
       s.runtime_status,
       s.bound_agent_node_id,
       s.bound_agent_session_ref,
       s.created_at,
       p.team_id
     FROM sessions s
     JOIN projects p ON p.id = s.project_id
     WHERE s.id = $1
       AND s.archived_at IS NULL`,
    [sessionId],
  );

  return result.rows[0];
}

async function loadVisibleScopeSnapshot(app: FastifyInstance, teamId: string) {
  const result = await app.db.query(
    `SELECT COALESCE(
       jsonb_agg(
         jsonb_build_object(
           'user_id',
           tm.user_id,
           'role',
           tm.role
         )
         ORDER BY tm.user_id
       ),
       '[]'::jsonb
     ) AS snapshot
     FROM team_members tm
     WHERE tm.team_id = $1`,
    [teamId],
  );

  return result.rows[0]?.snapshot ?? [];
}

function mapReplayEvent(row: Record<string, unknown>) {
  const payload =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {};

  if (row.event_type === "command.summary") {
    return {
      entry_type: "command_summary",
      occurred_at: asIso(row.occurred_at),
      summary: row.summary,
      payload,
    };
  }

  if (
    row.event_type === "session.shared" ||
    row.event_type === "session.privatized"
  ) {
    return {
      entry_type: "visibility_changed",
      occurred_at: asIso(row.occurred_at),
      from: payload.from ?? null,
      to:
        payload.to ??
        (row.event_type === "session.shared" ? "shared" : "private"),
      summary: row.summary,
    };
  }

  return {
    entry_type: "status_changed",
    occurred_at: asIso(row.occurred_at),
    summary: row.summary,
    event_type: row.event_type,
    payload,
  };
}

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/projects/:projectId/sessions", async (request, reply) => {
    const params = z
      .object({
        projectId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = sessionCreateSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const project = await loadProjectContext(app, params.data.projectId);
    if (!project) {
      return reply.code(404).send({ code: "PROJECT_NOT_FOUND" });
    }

    if (!project.has_nodes) {
      return reply.code(409).send({ code: "NODE_NOT_CONFIGURED" });
    }

    if (!project.online_node_id) {
      return reply.code(409).send({ code: "NODE_UNAVAILABLE" });
    }

    const sessionId = randomUUID();
    const binding = await app.workspaceRuntime.ensureSessionBinding({
      teamId: String(project.team_id),
      sessionId,
      nodeId: String(project.online_node_id),
    });

    const result = await app.db.query(
      `INSERT INTO sessions (
         id,
         project_id,
         creator_id,
         title,
         visibility,
         runtime_status,
         bound_agent_node_id,
         bound_agent_session_ref
       )
       VALUES ($1, $2, $3, $4, $5, 'idle', $6, $7)
       RETURNING
         id,
         project_id,
         creator_id,
         title,
         visibility,
         runtime_status,
         bound_agent_type,
         bound_agent_node_id,
         bound_agent_session_ref,
         last_message_at,
         created_at,
         updated_at`,
      [
        sessionId,
        params.data.projectId,
        project.created_by,
        body.data.title,
        body.data.visibility,
        project.online_node_id,
        binding.agentSessionRef,
      ],
    );

    return reply.code(201).send({
      data: serializeSession(result.rows[0]),
    });
  });

  app.get("/projects/:projectId/sessions", async (request, reply) => {
    const params = z
      .object({
        projectId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const query = sessionListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendValidationError(reply, query.error);
    }

    const values: unknown[] = [params.data.projectId];
    const filters = [
      "s.project_id = $1",
      "s.archived_at IS NULL",
    ];

    if (query.data.visibility) {
      values.push(query.data.visibility);
      filters.push(`s.visibility = $${values.length}`);
    }

    values.push(query.data.limit);

    const result = await app.db.query(
      `SELECT
         s.id,
         s.project_id,
         s.creator_id,
         s.title,
         s.visibility,
         s.runtime_status,
         s.bound_agent_type,
         s.bound_agent_node_id,
         s.bound_agent_session_ref,
         s.last_message_at,
         s.created_at,
         s.updated_at,
         COUNT(*) FILTER (
           WHERE m.processing_status IN ('accepted', 'queued', 'running')
         )::int AS pending_count
       FROM sessions s
       LEFT JOIN messages m ON m.session_id = s.id
       WHERE ${filters.join(" AND ")}
       GROUP BY s.id
       ORDER BY COALESCE(s.last_message_at, s.created_at) DESC, s.id DESC
       LIMIT $${values.length}`,
      values,
    );

    return {
      data: result.rows.map((row) => serializeSession(row)),
      next_cursor: null,
    };
  });

  app.get("/sessions/:sessionId", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const session = await loadSessionDetail(app, params.data.sessionId);
    if (!session) {
      return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
    }

    return {
      data: serializeSession(session),
    };
  });

  app.patch("/sessions/:sessionId/visibility", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = visibilityPatchSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const current = await loadSessionContext(app, params.data.sessionId);
    if (!current) {
      return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
    }

    if (current.visibility === body.data.visibility) {
      const session = await loadSessionDetail(app, params.data.sessionId);
      return {
        data: serializeSession(session),
      };
    }

    const snapshot = await loadVisibleScopeSnapshot(app, String(current.team_id));
    const client = await app.db.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE sessions
         SET visibility = $2,
             updated_at = now()
         WHERE id = $1`,
        [params.data.sessionId, body.data.visibility],
      );

      await client.query(
        `INSERT INTO session_audit_logs (
           session_id,
           action_type,
           previous_visibility,
           new_visibility,
           visible_scope_snapshot,
           shared_started_at,
           shared_ended_at,
           operator_id
         )
         VALUES ($1, 'visibility.changed', $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          params.data.sessionId,
          current.visibility,
          body.data.visibility,
          JSON.stringify(snapshot),
          body.data.visibility === "shared" ? new Date() : null,
          current.visibility === "shared" ? new Date() : null,
          current.creator_id,
        ],
      );

      await client.query(
        `INSERT INTO session_events (
           session_id,
           event_type,
           summary,
           payload,
           occurred_at
         )
         VALUES ($1, $2, $3, $4::jsonb, now())`,
        [
          params.data.sessionId,
          body.data.visibility === "shared"
            ? "session.shared"
            : "session.privatized",
          body.data.visibility === "shared"
            ? "Session visibility changed to shared"
            : "Session visibility changed to private",
          JSON.stringify({
            from: current.visibility,
            to: body.data.visibility,
            operator_id: current.creator_id,
          }),
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const session = await loadSessionDetail(app, params.data.sessionId);
    return {
      data: serializeSession(session),
    };
  });

  app.get("/sessions/:sessionId/audit-logs", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const result = await app.db.query(
      `SELECT
         id,
         session_id,
         action_type,
         previous_visibility,
         new_visibility,
         visible_scope_snapshot,
         shared_started_at,
         shared_ended_at,
         operator_id,
         created_at
       FROM session_audit_logs
       WHERE session_id = $1
       ORDER BY created_at DESC`,
      [params.data.sessionId],
    );

    return {
      data: result.rows.map((row) => serializeAuditLog(row)),
    };
  });

  app.get("/sessions/:sessionId/messages", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const result = await app.db.query(
      `SELECT
         id,
         session_id,
         sender_type,
         sender_user_id,
         content,
         processing_status,
         is_final_reply,
         client_message_id,
         error_summary,
         metadata,
         created_at
       FROM messages
       WHERE session_id = $1
         AND (
           sender_type = 'member'
           OR (sender_type = 'agent' AND is_final_reply = TRUE)
         )
       ORDER BY sequence_no ASC`,
      [params.data.sessionId],
    );

    return {
      data: result.rows.map((row) => serializeMessage(row)),
    };
  });

  app.post("/sessions/:sessionId/messages", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = messageCreateSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const client = await app.db.connect();

    try {
      await client.query("BEGIN");

      const sessionResult = await client.query(
        `SELECT
           id,
           creator_id,
           runtime_status
         FROM sessions
         WHERE id = $1
           AND archived_at IS NULL
         FOR UPDATE`,
        [params.data.sessionId],
      );

      const session = sessionResult.rows[0];
      if (!session) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
      }

      if (body.data.client_message_id) {
        const existing = await client.query(
          `SELECT
             id,
             session_id,
             sender_type,
             sender_user_id,
             content,
             processing_status,
             is_final_reply,
             client_message_id,
             error_summary,
             metadata,
             created_at
           FROM messages
           WHERE session_id = $1
             AND client_message_id = $2
           LIMIT 1`,
          [params.data.sessionId, body.data.client_message_id],
        );

        if (existing.rows[0]) {
          await client.query("COMMIT");
          return {
            data: {
              message: serializeMessage(existing.rows[0]),
              dispatch_state: {
                session_runtime_status: session.runtime_status,
                queue_position: 0,
              },
              duplicated: true,
            },
          };
        }
      }

      const pendingResult = await client.query(
        `SELECT COUNT(*) FILTER (
           WHERE processing_status IN ('accepted', 'queued', 'running')
         )::int AS pending_count,
         COALESCE(MAX(sequence_no), 0)::bigint AS last_sequence
         FROM messages
         WHERE session_id = $1`,
        [params.data.sessionId],
      );

      const pendingCount = Number(pendingResult.rows[0]?.pending_count ?? 0);
      const nextSequence = Number(pendingResult.rows[0]?.last_sequence ?? 0) + 1;
      const hasPendingMessages = pendingCount > 0;
      const nextRuntimeStatus =
        session.runtime_status === "running" ? "running" : "queued";
      const processingStatus = hasPendingMessages ? "queued" : "accepted";

      const messageResult = await client.query(
        `INSERT INTO messages (
           session_id,
           sender_type,
           sender_user_id,
           content,
           processing_status,
           is_final_reply,
           sequence_no,
           client_message_id,
           metadata
         )
         VALUES ($1, 'member', $2, $3, $4, FALSE, $5, $6, '{}'::jsonb)
         RETURNING
           id,
           session_id,
           sender_type,
           sender_user_id,
           content,
           processing_status,
           is_final_reply,
           client_message_id,
           error_summary,
           metadata,
           created_at`,
        [
          params.data.sessionId,
          session.creator_id,
          body.data.content,
          processingStatus,
          nextSequence,
          body.data.client_message_id ?? null,
        ],
      );

      await client.query(
        `UPDATE sessions
         SET runtime_status = $2,
             last_message_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [params.data.sessionId, nextRuntimeStatus],
      );

      if (nextRuntimeStatus !== session.runtime_status) {
        await appendStatusChangedEvent(client, {
          sessionId: params.data.sessionId,
          relatedMessageId: String(messageResult.rows[0].id),
          from: session.runtime_status,
          to: nextRuntimeStatus,
        });
      }

      if (processingStatus === "queued") {
        await appendMessageQueuedEvent(client, {
          sessionId: params.data.sessionId,
          messageId: String(messageResult.rows[0].id),
          queuePosition: pendingCount + 1,
        });
      }

      await client.query("COMMIT");
      app.workspaceRuntime.scheduleSession(params.data.sessionId);

      return reply.code(201).send({
        data: {
          message: serializeMessage(messageResult.rows[0]),
          dispatch_state: {
            session_runtime_status: nextRuntimeStatus,
            queue_position: pendingCount + 1,
          },
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");

      if (
        body.data.client_message_id &&
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "23505"
      ) {
        const existing = await app.db.query(
          `SELECT
             id,
             session_id,
             sender_type,
             sender_user_id,
             content,
             processing_status,
             is_final_reply,
             client_message_id,
             error_summary,
             metadata,
             created_at
           FROM messages
           WHERE session_id = $1
             AND client_message_id = $2
           LIMIT 1`,
          [params.data.sessionId, body.data.client_message_id],
        );

        if (existing.rows[0]) {
          return {
            data: {
              message: serializeMessage(existing.rows[0]),
              dispatch_state: {
                session_runtime_status: "queued",
                queue_position: 0,
              },
              duplicated: true,
            },
          };
        }
      }

      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/sessions/:sessionId/replay", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const [messagesResult, eventsResult] = await Promise.all([
      app.db.query(
        `SELECT
           id,
           sender_type,
           content,
           created_at
         FROM messages
         WHERE session_id = $1
           AND (
             sender_type = 'member'
             OR (sender_type = 'agent' AND is_final_reply = TRUE)
           )`,
        [params.data.sessionId],
      ),
      app.db.query(
        `SELECT
           event_type,
           summary,
           payload,
           occurred_at
         FROM session_events
         WHERE session_id = $1`,
        [params.data.sessionId],
      ),
    ]);

    const entries = [
      ...messagesResult.rows.map((row) => ({
        entry_type: "message",
        message_id: row.id,
        occurred_at: asIso(row.created_at),
        sender_type: row.sender_type,
        content: row.content,
      })),
      ...eventsResult.rows.map((row) => mapReplayEvent(row)),
    ].sort((left, right) =>
      String(left.occurred_at).localeCompare(String(right.occurred_at)),
    );

    return {
      data: entries,
    };
  });

  app.get("/teams/:teamId/search", async (request, reply) => {
    const params = z
      .object({
        teamId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const query = searchQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendValidationError(reply, query.error);
    }

    const result = await app.db.query(
      `SELECT
         m.id AS message_id,
         m.session_id,
         s.project_id,
         m.sender_type,
         m.content,
         m.created_at
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       JOIN projects p ON p.id = s.project_id
       WHERE p.team_id = $1
         AND ($2::uuid IS NULL OR s.project_id = $2)
         AND m.search_vector @@ plainto_tsquery('simple', $3)
       ORDER BY m.created_at DESC
       LIMIT $4`,
      [
        params.data.teamId,
        query.data.project_id ?? null,
        query.data.q,
        query.data.limit,
      ],
    );

    return {
      data: result.rows.map((row) => ({
        session_id: row.session_id,
        project_id: row.project_id,
        message_id: row.message_id,
        sender_type: row.sender_type,
        snippet: String(row.content).slice(0, 200),
        occurred_at: asIso(row.created_at),
      })),
      next_cursor: null,
    };
  });

  app.get("/sessions/:sessionId/todos", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const result = await app.db.query(
      `SELECT
         id,
         session_id,
         source_message_id,
         title,
         status,
         creator_id,
         created_at,
         updated_at
       FROM todos
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [params.data.sessionId],
    );

    return {
      data: result.rows.map((row) => serializeTodo(row)),
    };
  });

  app.post("/sessions/:sessionId/todos", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = todoCreateSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const session = await loadSessionContext(app, params.data.sessionId);
    if (!session) {
      return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
    }

    try {
      const result = await app.db.query(
        `INSERT INTO todos (
           session_id,
           source_message_id,
           title,
           status,
           creator_id
         )
         VALUES ($1, $2, $3, 'pending', $4)
         RETURNING
           id,
           session_id,
           source_message_id,
           title,
           status,
           creator_id,
           created_at,
           updated_at`,
        [
          params.data.sessionId,
          body.data.source_message_id,
          body.data.title,
          session.creator_id,
        ],
      );

      return reply.code(201).send({
        data: serializeTodo(result.rows[0]),
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "23503"
      ) {
        return reply.code(404).send({ code: "MESSAGE_NOT_FOUND" });
      }

      throw error;
    }
  });

  app.patch("/todos/:todoId", async (request, reply) => {
    const params = z
      .object({
        todoId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = todoPatchSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const result = await app.db.query(
      `UPDATE todos
       SET status = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING
         id,
         session_id,
         source_message_id,
         title,
         status,
         creator_id,
         created_at,
         updated_at`,
      [params.data.todoId, body.data.status],
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ code: "TODO_NOT_FOUND" });
    }

    return {
      data: serializeTodo(result.rows[0]),
    };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (!reply.sent) {
      reply.code(500).send({
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}
