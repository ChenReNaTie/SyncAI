import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
import { verifyAccessToken } from "../lib/auth.js";
import { resolvePersistedCodexThreadId } from "../lib/codex-agent-adapter.js";
import type { AgentSessionConfig } from "../lib/agent-execution.js";
import {
  buildSessionAgentRuntime,
  listCodexApprovalPolicies,
  listCodexModels,
  listCodexReasoningEfforts,
  listCodexSandboxModes,
  listConfiguredModels,
  listWorkspaceBranches,
  readCodexConfigDefaults,
} from "../lib/codex-observability.js";

const sessionCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  visibility: z.enum(sessionVisibilityValues),
});

const sessionListQuerySchema = z.object({
  visibility: z.enum(sessionVisibilityValues).optional(),
  cursor: z.string().trim().min(1).optional(),
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
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const todoCreateSchema = z.object({
  source_message_id: z.string().uuid(),
  title: z.string().trim().min(1).max(255),
});

const todoPatchSchema = z.object({
  status: z.enum(todoStatusValues),
});

const agentConfigPatchSchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
  reasoning_effort: z.string().trim().min(1).max(100).optional(),
  approval_policy: z.string().trim().min(1).max(100).optional(),
  sandbox_mode: z.string().trim().min(1).max(100).optional(),
  branch: z.string().trim().min(1).max(300).optional(),
});

const actorHeaderSchema = z.string().uuid();
const optionalCursorProjectIdSchema = z.union([z.string().uuid(), z.literal("")]);
const optionalCursorVisibilitySchema = z.union([
  z.enum(sessionVisibilityValues),
  z.literal(""),
]);

const sessionCursorSchema = z.object({
  sort_at: z.string().datetime({ offset: true }),
  session_id: z.string().uuid(),
  project_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  visibility: optionalCursorVisibilitySchema,
});

const searchCursorSchema = z.object({
  occurred_at: z.string().datetime({ offset: true }),
  message_id: z.string().uuid(),
  team_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  project_id: optionalCursorProjectIdSchema,
  q: z.string(),
});

const AGENT_SENDER_DISPLAY_NAME = "Codex";

function asIso(value: unknown) {
  if (!value) {
    return null;
  }

  return new Date(String(value)).toISOString();
}

function parseStoredAgentConfig(value: unknown): AgentSessionConfig {
  if (!value || typeof value !== "object") {
    return {};
  }

  const config = value as Record<string, unknown>;
  return {
    ...(typeof config.model === "string" && config.model.trim().length > 0
      ? { model: config.model.trim() }
      : {}),
    ...(typeof config.reasoning_effort === "string"
      && config.reasoning_effort.trim().length > 0
      ? { reasoning_effort: config.reasoning_effort.trim() }
      : {}),
    ...(typeof config.approval_policy === "string"
      && config.approval_policy.trim().length > 0
      ? { approval_policy: config.approval_policy.trim() }
      : {}),
    ...(typeof config.sandbox_mode === "string"
      && config.sandbox_mode.trim().length > 0
      ? { sandbox_mode: config.sandbox_mode.trim() }
      : {}),
    ...(typeof config.branch === "string" && config.branch.trim().length > 0
      ? { branch: config.branch.trim() }
      : {}),
  };
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    code: "INVALID_REQUEST",
    details: error.flatten(),
  });
}

function sendInvalidFieldOption(
  reply: FastifyReply,
  field: string,
  message: string,
) {
  return reply.code(400).send({
    code: "INVALID_REQUEST",
    details: {
      formErrors: [],
      fieldErrors: {
        [field]: [message],
      },
    },
  });
}

function sendInvalidCursor(reply: FastifyReply) {
  return reply.code(400).send({
    code: "INVALID_REQUEST",
    details: {
      formErrors: [],
      fieldErrors: {
        cursor: ["Invalid cursor"],
      },
    },
  });
}

function sendAuthRequired(reply: FastifyReply) {
  return reply.code(401).send({
    code: "AUTH_REQUIRED",
  });
}

function getSingleHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getAuthorizationBearerToken(request: FastifyRequest) {
  const authorization = getSingleHeaderValue(request.headers.authorization);
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return "";
  }

  return match[1].trim();
}

function requireActorUserId(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const bearerToken = getAuthorizationBearerToken(request);
  if (bearerToken !== null) {
    const token = verifyAccessToken(
      bearerToken,
      request.server.config.authAccessSecret,
    );
    if (token) {
      return token.userId;
    }

    const legacyBearerActor = actorHeaderSchema.safeParse(bearerToken);
    if (legacyBearerActor.success) {
      return legacyBearerActor.data;
    }

    sendAuthRequired(reply);
    return null;
  }

  const actorHeader =
    getSingleHeaderValue(request.headers["x-syncai-user-id"]) ??
    getSingleHeaderValue(request.headers["x-user-id"]);

  if (!actorHeader) {
    sendAuthRequired(reply);
    return null;
  }

  const actorUserId = actorHeaderSchema.safeParse(actorHeader);
  if (!actorUserId.success) {
    sendAuthRequired(reply);
    return null;
  }

  return actorUserId.data;
}

function encodeCursor(payload: Record<string, string>) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function toCursorScopeValue(value: string | undefined) {
  return value ?? "";
}

function decodeCursor<T>(
  cursor: string,
  schema: z.ZodType<T>,
): T | null {
  try {
    const payload = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const result = schema.safeParse(payload);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function buildCursorResponse<T>(data: T[], nextCursor: string | null) {
  return {
    data,
    meta: {
      next_cursor: nextCursor,
    },
  };
}

function hasSessionVisibility(
  session: Record<string, unknown>,
  actorUserId: string,
) {
  return (
    session.visibility === "shared" ||
    String(session.creator_id) === actorUserId
  );
}

function hasMatchingSessionCursorScope(
  cursor: z.infer<typeof sessionCursorSchema>,
  input: {
    projectId: string;
    actorUserId: string;
    visibility?: string | undefined;
  },
) {
  return (
    cursor.project_id === input.projectId &&
    cursor.actor_user_id === input.actorUserId &&
    cursor.visibility === toCursorScopeValue(input.visibility)
  );
}

function hasMatchingSearchCursorScope(
  cursor: z.infer<typeof searchCursorSchema>,
  input: {
    teamId: string;
    actorUserId: string;
    projectId?: string | undefined;
    q: string;
  },
) {
  return (
    cursor.team_id === input.teamId &&
    cursor.actor_user_id === input.actorUserId &&
    cursor.project_id === toCursorScopeValue(input.projectId) &&
    cursor.q === input.q
  );
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
  const senderType = String(row.sender_type);
  const senderDisplayName =
    senderType === "member" &&
    typeof row.sender_display_name === "string" &&
    row.sender_display_name.trim().length > 0
      ? row.sender_display_name
      : senderType === "member"
        ? "Unknown member"
        : AGENT_SENDER_DISPLAY_NAME;

  return {
    id: row.id,
    session_id: row.session_id,
    sender: senderType === "member" ? "user" : "agent",
    sender_type: row.sender_type,
    sender_user_id: row.sender_user_id,
    sender_display_name: senderDisplayName,
    content: row.content,
    processing_status: row.processing_status,
    is_final_reply: Boolean(row.is_final_reply),
    client_message_id: row.client_message_id,
    error_summary: row.error_summary,
    metadata: row.metadata ?? {},
    created_at: asIso(row.created_at),
  };
}

function buildMessageSelectColumns(
  messageAlias: string,
  userAlias: string,
) {
  return `
         ${messageAlias}.id,
         ${messageAlias}.session_id,
         ${messageAlias}.sender_type,
         ${messageAlias}.sender_user_id,
         ${userAlias}.display_name AS sender_display_name,
         ${messageAlias}.content,
         ${messageAlias}.processing_status,
         ${messageAlias}.is_final_reply,
         ${messageAlias}.client_message_id,
         ${messageAlias}.error_summary,
         ${messageAlias}.metadata,
         ${messageAlias}.created_at`;
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
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN messages m ON m.session_id = s.id
     WHERE s.id = $1
       AND s.archived_at IS NULL
       AND p.archived_at IS NULL
     GROUP BY s.id`,
    [sessionId],
  );

  return result.rows[0];
}

async function loadSessionAgentContext(
  app: FastifyInstance,
  sessionId: string,
) {
  const result = await app.db.query(
    `SELECT
       s.bound_agent_session_ref,
       p.working_directory,
       agent_message.metadata AS latest_agent_metadata
     FROM sessions s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN LATERAL (
       SELECT metadata
       FROM messages
       WHERE session_id = s.id
         AND sender_type = 'agent'
         AND is_final_reply = TRUE
       ORDER BY sequence_no DESC
       LIMIT 1
     ) AS agent_message ON TRUE
     WHERE s.id = $1
       AND s.archived_at IS NULL
       AND p.archived_at IS NULL`,
    [sessionId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const threadId =
    typeof row.bound_agent_session_ref === "string"
      ? resolvePersistedCodexThreadId(
          sessionId,
          String(row.bound_agent_session_ref),
        )
      : undefined;

  const workingDirectory =
    typeof row.working_directory === "string"
      ? String(row.working_directory)
      : undefined;
  const latestMetadata =
    row.latest_agent_metadata && typeof row.latest_agent_metadata === "object"
      ? (row.latest_agent_metadata as Record<string, unknown>)
      : undefined;

  return buildSessionAgentRuntime({
    ...(threadId ? { threadId } : {}),
    ...(workingDirectory ? { workingDirectory } : {}),
    ...(latestMetadata ? { latestMetadata } : {}),
  });
}

function mergeOptionValues(
  primary: string[],
  extras: Array<string | null | undefined>,
) {
  return [...new Set(
    [...primary, ...extras]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim()),
  )];
}

async function loadSessionAgentSettings(
  app: FastifyInstance,
  sessionId: string,
) {
  const result = await app.db.query(
    `SELECT
       s.agent_config,
       s.bound_agent_session_ref,
       p.working_directory,
       agent_message.metadata AS latest_agent_metadata
     FROM sessions s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN LATERAL (
       SELECT metadata
       FROM messages
       WHERE session_id = s.id
         AND sender_type = 'agent'
         AND is_final_reply = TRUE
       ORDER BY sequence_no DESC
       LIMIT 1
     ) AS agent_message ON TRUE
     WHERE s.id = $1
       AND s.archived_at IS NULL
       AND p.archived_at IS NULL`,
    [sessionId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const selected = parseStoredAgentConfig(row.agent_config);
  const threadId =
    typeof row.bound_agent_session_ref === "string"
      ? resolvePersistedCodexThreadId(
          sessionId,
          String(row.bound_agent_session_ref),
        )
      : undefined;
  const workingDirectory =
    typeof row.working_directory === "string"
      ? String(row.working_directory)
      : undefined;
  const latestMetadata =
    row.latest_agent_metadata && typeof row.latest_agent_metadata === "object"
      ? (row.latest_agent_metadata as Record<string, unknown>)
      : undefined;
  const runtime = buildSessionAgentRuntime({
    ...(threadId ? { threadId } : {}),
    ...(workingDirectory ? { workingDirectory } : {}),
    ...(latestMetadata ? { latestMetadata } : {}),
  });
  const defaults = readCodexConfigDefaults();
  const selectedModel = selected.model ?? runtime?.model ?? defaults.model ?? null;
  const models = mergeOptionValues(
    [...listCodexModels(), ...listConfiguredModels()],
    [runtime?.model, selected.model, defaults.model],
  );
  const reasoningEfforts = mergeOptionValues(
    listCodexReasoningEfforts(selectedModel),
    [
      selected.reasoning_effort,
      runtime?.reasoning_effort,
      defaults.reasoningEffort,
    ],
  );
  const sandboxModes = mergeOptionValues(
    listCodexSandboxModes(),
    [selected.sandbox_mode, runtime?.sandbox_mode, defaults.sandboxMode],
  );
  const approvalPolicies = mergeOptionValues(
    listCodexApprovalPolicies(),
    [selected.approval_policy, runtime?.approval_policy, defaults.approvalPolicy],
  );
  const branches = mergeOptionValues(
    listWorkspaceBranches(workingDirectory),
    [selected.branch, runtime?.branch],
  );

  return {
    selected,
    runtime,
    options: {
      models,
      reasoning_efforts: reasoningEfforts,
      approval_policies: approvalPolicies,
      sandbox_modes: sandboxModes,
      branches,
    },
  };
}

async function loadProjectContext(app: FastifyInstance, projectId: string) {
  const result = await app.db.query(
    `SELECT
       p.id,
       p.team_id,
       p.created_by,
       p.working_directory,
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

async function loadTeamContext(app: FastifyInstance, teamId: string) {
  const result = await app.db.query(
    `SELECT
       id,
       created_by
     FROM teams
     WHERE id = $1`,
    [teamId],
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
       AND s.archived_at IS NULL
       AND p.archived_at IS NULL`,
    [sessionId],
  );

  return result.rows[0];
}

async function loadTodoContext(app: FastifyInstance, todoId: string) {
  const result = await app.db.query(
    `SELECT
       t.id,
       t.session_id,
       s.creator_id,
       s.visibility,
       p.team_id
     FROM todos t
     JOIN sessions s ON s.id = t.session_id
     JOIN projects p ON p.id = s.project_id
     WHERE t.id = $1
       AND s.archived_at IS NULL
       AND p.archived_at IS NULL`,
    [todoId],
  );

  return result.rows[0];
}

async function isTeamMember(
  app: FastifyInstance,
  teamId: string,
  userId: string,
) {
  const result = await app.db.query(
    `SELECT 1
     FROM team_members
     WHERE team_id = $1
       AND user_id = $2
     LIMIT 1`,
    [teamId, userId],
  );

  return Boolean(result.rows[0]);
}

async function requireProjectMember(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  project: Record<string, unknown>,
) {
  const actorUserId = requireActorUserId(request, reply);
  if (!actorUserId) {
    return null;
  }

  const member = await isTeamMember(app, String(project.team_id), actorUserId);
  if (!member) {
    reply.code(404).send({ code: "PROJECT_NOT_FOUND" });
    return null;
  }

  return actorUserId;
}

async function requireTeamMember(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  team: Record<string, unknown>,
) {
  const actorUserId = requireActorUserId(request, reply);
  if (!actorUserId) {
    return null;
  }

  const member = await isTeamMember(app, String(team.id), actorUserId);
  if (!member) {
    reply.code(404).send({ code: "TEAM_NOT_FOUND" });
    return null;
  }

  return actorUserId;
}

async function requireVisibleSession(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  sessionId: string,
  options: {
    requireCreator?: boolean;
  } = {},
) {
  const session = await loadSessionContext(app, sessionId);
  if (!session) {
    reply.code(404).send({ code: "SESSION_NOT_FOUND" });
    return null;
  }

  const actorUserId = requireActorUserId(request, reply);
  if (!actorUserId) {
    return null;
  }

  const member = await isTeamMember(app, String(session.team_id), actorUserId);
  if (!member || !hasSessionVisibility(session, actorUserId)) {
    reply.code(403).send({ code: "SESSION_NOT_VISIBLE" });
    return null;
  }

  if (
    options.requireCreator &&
    String(session.creator_id) !== actorUserId
  ) {
    reply.code(403).send({ code: "SESSION_FORBIDDEN" });
    return null;
  }

  return {
    session,
    actorUserId,
  };
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

async function loadSharedStartedAt(
  app: FastifyInstance,
  sessionId: string,
  sessionCreatedAt: unknown,
) {
  const result = await app.db.query(
    `SELECT shared_started_at
     FROM session_audit_logs
     WHERE session_id = $1
       AND new_visibility = 'shared'
       AND shared_started_at IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId],
  );

  return result.rows[0]?.shared_started_at ?? sessionCreatedAt;
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

  if (row.event_type !== "status.changed") {
    return null;
  }

  return {
    entry_type: "status_changed",
    occurred_at: asIso(row.occurred_at),
    from: payload.from ?? null,
    to: payload.to ?? null,
    summary: row.summary,
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

    const actorUserId = await requireProjectMember(
      app,
      request,
      reply,
      project,
    );
    if (!actorUserId) {
      return;
    }

    if (!project.has_nodes) {
      return reply.code(409).send({ code: "NODE_NOT_CONFIGURED" });
    }

    if (!project.online_node_id) {
      return reply.code(409).send({ code: "NODE_UNAVAILABLE" });
    }

    const sessionId = randomUUID();
    const workingDirectory = project.working_directory
      ? String(project.working_directory)
      : undefined;

    const binding = await app.workspaceRuntime.ensureSessionBinding({
      teamId: String(project.team_id),
      sessionId,
      nodeId: String(project.online_node_id),
      ...(workingDirectory !== undefined
        ? ({ workingDirectory } as const)
        : {}),
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
        actorUserId,
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

    const project = await loadProjectContext(app, params.data.projectId);
    if (!project) {
      return reply.code(404).send({ code: "PROJECT_NOT_FOUND" });
    }

    const actorUserId = await requireProjectMember(
      app,
      request,
      reply,
      project,
    );
    if (!actorUserId) {
      return;
    }

    const cursor = query.data.cursor
      ? decodeCursor(query.data.cursor, sessionCursorSchema)
      : null;

    if (
      query.data.cursor &&
      (!cursor ||
        !hasMatchingSessionCursorScope(cursor, {
          projectId: params.data.projectId,
          actorUserId,
          visibility: query.data.visibility,
        }))
    ) {
      return sendInvalidCursor(reply);
    }

    const values: unknown[] = [params.data.projectId, actorUserId];
    const filters = [
      "s.project_id = $1",
      "s.archived_at IS NULL",
      "(s.visibility = 'shared' OR s.creator_id = $2)",
    ];

    if (query.data.visibility) {
      values.push(query.data.visibility);
      filters.push(`s.visibility = $${values.length}`);
    }

    if (cursor) {
      values.push(cursor.sort_at);
      const cursorSortIndex = values.length;
      values.push(cursor.session_id);
      const cursorSessionIndex = values.length;
      filters.push(
        `(COALESCE(s.last_message_at, s.created_at) < $${cursorSortIndex}::timestamptz
          OR (
            COALESCE(s.last_message_at, s.created_at) = $${cursorSortIndex}::timestamptz
            AND s.id < $${cursorSessionIndex}::uuid
          ))`,
      );
    }

    values.push(query.data.limit + 1);

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
         COALESCE(s.last_message_at, s.created_at) AS sort_at,
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

    const hasMore = result.rows.length > query.data.limit;
    const pageRows = hasMore
      ? result.rows.slice(0, query.data.limit)
      : result.rows;
    const nextCursor = hasMore
      ? encodeCursor({
          sort_at: asIso(pageRows.at(-1)?.sort_at) ?? "",
          session_id: String(pageRows.at(-1)?.id ?? ""),
          project_id: params.data.projectId,
          actor_user_id: actorUserId,
          visibility: toCursorScopeValue(query.data.visibility),
        })
      : null;

    return buildCursorResponse(
      pageRows.map((row) => serializeSession(row)),
      nextCursor,
    );
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

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
    );
    if (!access) {
      return;
    }

    const session = await loadSessionDetail(app, params.data.sessionId);

    return {
      data: serializeSession(session),
    };
  });

  app.get("/sessions/:sessionId/agent-context", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
    );
    if (!access) {
      return;
    }

    const context = await loadSessionAgentContext(app, params.data.sessionId);

    return {
      data: context,
    };
  });

  app.get("/sessions/:sessionId/agent-config", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
    );
    if (!access) {
      return;
    }

    const config = await loadSessionAgentSettings(app, params.data.sessionId);
    return {
      data: config,
    };
  });

  app.patch("/sessions/:sessionId/agent-config", async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = agentConfigPatchSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
      {
        requireCreator: true,
      },
    );
    if (!access) {
      return;
    }

    const currentSettings = await loadSessionAgentSettings(app, params.data.sessionId);
    if (!currentSettings) {
      return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
    }

    const nextConfig = parseStoredAgentConfig({
      ...currentSettings.selected,
      ...body.data,
    });
    const defaults = readCodexConfigDefaults();
    const nextModel =
      nextConfig.model
      ?? currentSettings.runtime?.model
      ?? defaults.model
      ?? null;

    if (body.data.model) {
      const knownModels = new Set<string>(currentSettings.options.models);
      if (knownModels.size > 0 && !knownModels.has(body.data.model)) {
        return sendInvalidFieldOption(
          reply,
          "model",
          "Model is not available in the current Codex configuration",
        );
      }
    }

    const availableReasoningEfforts = mergeOptionValues(
      listCodexReasoningEfforts(nextModel),
      [
        currentSettings.runtime?.reasoning_effort,
        defaults.reasoningEffort,
      ],
    );
    if (
      body.data.reasoning_effort
      && availableReasoningEfforts.length > 0
      && !availableReasoningEfforts.includes(body.data.reasoning_effort)
    ) {
      return sendInvalidFieldOption(
        reply,
        "reasoning_effort",
        "Reasoning effort is not supported by the selected Codex model",
      );
    }

    if (
      nextConfig.reasoning_effort
      && availableReasoningEfforts.length > 0
      && !availableReasoningEfforts.includes(nextConfig.reasoning_effort)
    ) {
      nextConfig.reasoning_effort =
        availableReasoningEfforts[0]
        ?? currentSettings.runtime?.reasoning_effort
        ?? defaults.reasoningEffort
        ?? null;
    }

    if (body.data.approval_policy) {
      const knownApprovalPolicies = new Set<string>(
        currentSettings.options.approval_policies,
      );
      if (
        knownApprovalPolicies.size > 0
        && !knownApprovalPolicies.has(body.data.approval_policy)
      ) {
        return sendInvalidFieldOption(
          reply,
          "approval_policy",
          "Approval policy is not available in the current Codex CLI",
        );
      }
    }

    if (body.data.sandbox_mode) {
      const knownSandboxModes = new Set<string>(currentSettings.options.sandbox_modes);
      if (knownSandboxModes.size > 0 && !knownSandboxModes.has(body.data.sandbox_mode)) {
        return sendInvalidFieldOption(
          reply,
          "sandbox_mode",
          "Sandbox mode is not available in the current Codex CLI",
        );
      }
    }

    if (body.data.branch) {
      const knownBranches = new Set<string>(currentSettings.options.branches);
      if (knownBranches.size > 0 && !knownBranches.has(body.data.branch)) {
        return sendInvalidFieldOption(
          reply,
          "branch",
          "Branch does not exist in the current workspace",
        );
      }
    }

    await app.db.query(
      `UPDATE sessions
       SET agent_config = $2::jsonb,
           updated_at = now()
       WHERE id = $1
         AND archived_at IS NULL`,
      [
        params.data.sessionId,
        JSON.stringify(nextConfig),
      ],
    );

    const updated = await loadSessionAgentSettings(app, params.data.sessionId);
    return {
      data: updated,
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

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
      {
        requireCreator: true,
      },
    );
    if (!access) {
      return;
    }

    const current = access.session;
    const actorUserId = access.actorUserId;

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
      const transitionAt = new Date();
      const sharedStartedAt =
        body.data.visibility === "shared"
          ? transitionAt
          : await loadSharedStartedAt(
              app,
              params.data.sessionId,
              current.created_at,
            );

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
          sharedStartedAt,
          body.data.visibility === "private" ? transitionAt : null,
          actorUserId,
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
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
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
            operator_id: actorUserId,
          }),
          transitionAt,
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

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
    );
    if (!access) {
      return;
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

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
    );
    if (!access) {
      return;
    }

    const result = await app.db.query(
      `SELECT
${buildMessageSelectColumns("m", "u")}
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_user_id
       WHERE m.session_id = $1
         AND (
           m.sender_type = 'member'
           OR (m.sender_type = 'agent' AND m.is_final_reply = TRUE)
         )
       ORDER BY m.sequence_no ASC`,
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

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
    );
    if (!access) {
      return;
    }

    const actorUserId = access.actorUserId;

    const client = await app.db.connect();

    try {
      await client.query("BEGIN");

      const sessionResult = await client.query(
        `SELECT
           s.id,
           s.creator_id,
           s.runtime_status
         FROM sessions s
         JOIN projects p ON p.id = s.project_id
         WHERE s.id = $1
           AND s.archived_at IS NULL
           AND p.archived_at IS NULL
         FOR UPDATE OF s, p`,
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
${buildMessageSelectColumns("m", "u")}
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_user_id
           WHERE m.session_id = $1
             AND m.client_message_id = $2
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
              idempotent_replay: true,
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
        `WITH inserted AS (
           INSERT INTO messages (
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
             created_at
         )
         SELECT
${buildMessageSelectColumns("inserted", "u")}
         FROM inserted
         LEFT JOIN users u ON u.id = inserted.sender_user_id`,
        [
          params.data.sessionId,
          actorUserId,
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
      app.workspaceRuntime.emit("message.new", {
        sessionId: params.data.sessionId,
        message: serializeMessage(messageResult.rows[0]),
      });
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
${buildMessageSelectColumns("m", "u")}
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_user_id
           WHERE m.session_id = $1
             AND m.client_message_id = $2
           LIMIT 1`,
          [params.data.sessionId, body.data.client_message_id],
        );

        if (existing.rows[0]) {
          const sessionState = await app.db.query(
            `SELECT s.runtime_status
             FROM sessions s
             JOIN projects p ON p.id = s.project_id
             WHERE s.id = $1
               AND s.archived_at IS NULL
               AND p.archived_at IS NULL`,
            [params.data.sessionId],
          );

          if (!sessionState.rows[0]) {
            return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
          }

          return {
            data: {
              message: serializeMessage(existing.rows[0]),
              dispatch_state: {
                session_runtime_status: sessionState.rows[0].runtime_status,
                queue_position: 0,
              },
              duplicated: true,
              idempotent_replay: true,
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

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
    );
    if (!access) {
      return;
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
         WHERE session_id = $1
           AND event_type IN (
             'status.changed',
             'command.summary',
             'session.shared',
             'session.privatized'
           )`,
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
      ...eventsResult.rows
        .map((row) => mapReplayEvent(row))
        .filter((entry) => entry !== null),
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

    const team = await loadTeamContext(app, params.data.teamId);
    if (!team) {
      return reply.code(404).send({ code: "TEAM_NOT_FOUND" });
    }

    const actorUserId = await requireTeamMember(app, request, reply, team);
    if (!actorUserId) {
      return;
    }

    const cursor = query.data.cursor
      ? decodeCursor(query.data.cursor, searchCursorSchema)
      : null;

    if (
      query.data.cursor &&
      (!cursor ||
        !hasMatchingSearchCursorScope(cursor, {
          teamId: params.data.teamId,
          actorUserId,
          projectId: query.data.project_id,
          q: query.data.q,
        }))
    ) {
      return sendInvalidCursor(reply);
    }

    const values: unknown[] = [
      params.data.teamId,
      actorUserId,
      query.data.project_id ?? null,
      query.data.q,
    ];
    const filters = [
      "p.team_id = $1",
      "p.archived_at IS NULL",
      "s.archived_at IS NULL",
      "($3::uuid IS NULL OR s.project_id = $3)",
      "(s.visibility = 'shared' OR s.creator_id = $2)",
      "m.search_vector @@ plainto_tsquery('simple', $4)",
    ];

    if (cursor) {
      values.push(cursor.occurred_at);
      const cursorOccurredIndex = values.length;
      values.push(cursor.message_id);
      const cursorMessageIndex = values.length;
      filters.push(
        `(m.created_at < $${cursorOccurredIndex}::timestamptz
          OR (
            m.created_at = $${cursorOccurredIndex}::timestamptz
            AND m.id < $${cursorMessageIndex}::uuid
          ))`,
      );
    }

    values.push(query.data.limit + 1);

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
       WHERE ${filters.join(" AND ")}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $${values.length}`,
      values,
    );

    const hasMore = result.rows.length > query.data.limit;
    const pageRows = hasMore
      ? result.rows.slice(0, query.data.limit)
      : result.rows;
    const nextCursor = hasMore
      ? encodeCursor({
          occurred_at: asIso(pageRows.at(-1)?.created_at) ?? "",
          message_id: String(pageRows.at(-1)?.message_id ?? ""),
          team_id: params.data.teamId,
          actor_user_id: actorUserId,
          project_id: toCursorScopeValue(query.data.project_id),
          q: query.data.q,
        })
      : null;

    return buildCursorResponse(
      pageRows.map((row) => ({
        session_id: row.session_id,
        project_id: row.project_id,
        message_id: row.message_id,
        sender_type: row.sender_type,
        snippet: String(row.content).slice(0, 200),
        occurred_at: asIso(row.created_at),
      })),
      nextCursor,
    );
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

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
    );
    if (!access) {
      return;
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

    const access = await requireVisibleSession(
      app,
      request,
      reply,
      params.data.sessionId,
    );
    if (!access) {
      return;
    }

    const sourceMessage = await app.db.query(
      `SELECT id
       FROM messages
       WHERE id = $1
         AND session_id = $2
         AND (
           sender_type = 'member'
           OR (sender_type = 'agent' AND is_final_reply = TRUE)
         )`,
      [body.data.source_message_id, params.data.sessionId],
    );

    if (!sourceMessage.rows[0]) {
      return reply.code(404).send({ code: "MESSAGE_NOT_FOUND" });
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
          access.actorUserId,
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

    const todo = await loadTodoContext(app, params.data.todoId);
    if (!todo) {
      return reply.code(404).send({ code: "TODO_NOT_FOUND" });
    }

    const actorUserId = requireActorUserId(request, reply);
    if (!actorUserId) {
      return;
    }

    const member = await isTeamMember(app, String(todo.team_id), actorUserId);
    if (!member || !hasSessionVisibility(todo, actorUserId)) {
      return reply.code(403).send({ code: "SESSION_NOT_VISIBLE" });
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
