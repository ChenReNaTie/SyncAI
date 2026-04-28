import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyAccessToken } from "../lib/auth.js";

const actorHeaderSchema = z.string().uuid();

const teamCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
});

const teamParamsSchema = z.object({
  teamId: z.string().uuid(),
});

const teamMemberParamsSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
});

const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional(),
  working_directory: z.string().trim().max(1000).optional(),
});

const teamMemberCreateSchema = z
  .object({
    user_id: z.string().uuid().optional(),
    email: z.string().email().optional(),
    role: z.enum(["admin", "member"]),
  })
  .refine((data) => data.user_id || data.email, {
    message: "请提供 user_id 或 email 至少一项",
  });

const teamMemberPatchSchema = z.object({
  role: z.enum(["admin", "member"]),
});

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

const projectArchiveSchema = z.object({
  archived: z.boolean(),
});

const agentNodeUpsertSchema = z.object({
  display_name: z.string().trim().min(1).max(100),
  client_fingerprint: z.string().trim().min(1).max(255),
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

function serializeTeam(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    default_agent_type: row.default_agent_type,
    created_by: row.created_by,
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    member_role: row.member_role,
  };
}

function serializeProject(row: Record<string, unknown>) {
  return {
    id: row.id,
    team_id: row.team_id,
    name: row.name,
    description: row.description ?? null,
    working_directory: row.working_directory ?? null,
    created_by: row.created_by,
    archived_at: asIso(row.archived_at),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function serializeTeamMember(row: Record<string, unknown>) {
  return {
    team_id: row.team_id,
    user_id: row.user_id,
    role: row.role,
    joined_at: asIso(row.joined_at),
    invited_by: row.invited_by ?? null,
  };
}

function serializeAgentNode(row: Record<string, unknown>) {
  return {
    id: row.id,
    team_id: row.team_id,
    owner_user_id: row.owner_user_id,
    agent_type: row.agent_type,
    node_mode: row.node_mode,
    display_name: row.display_name,
    connection_status: row.connection_status,
    client_fingerprint: row.client_fingerprint ?? null,
    last_heartbeat_at: asIso(row.last_heartbeat_at),
    metadata: row.metadata ?? {},
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

async function loadActiveUser(app: FastifyInstance, userId: string) {
  const result = await app.db.query(
    `SELECT id
     FROM users
     WHERE id = $1
       AND status = 'active'`,
    [userId],
  );

  return result.rows[0];
}

async function requireActiveActor(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const actorUserId = requireActorUserId(request, reply);
  if (!actorUserId) {
    return null;
  }

  const actor = await loadActiveUser(app, actorUserId);
  if (!actor) {
    sendAuthRequired(reply);
    return null;
  }

  return actorUserId;
}

async function loadTeamForActor(
  app: FastifyInstance,
  teamId: string,
  actorUserId: string,
) {
  const result = await app.db.query(
    `SELECT
       t.id,
       t.name,
       t.slug,
       t.default_agent_type,
       t.created_by,
       t.created_at,
       t.updated_at,
       tm.role AS member_role
     FROM teams t
     JOIN team_members tm
       ON tm.team_id = t.id
      AND tm.user_id = $2
     WHERE t.id = $1`,
    [teamId, actorUserId],
  );

  return result.rows[0];
}

async function loadProjectForActor(
  app: FastifyInstance,
  projectId: string,
  actorUserId: string,
) {
  const result = await app.db.query(
    `SELECT
       p.id,
       p.team_id,
       p.name,
       p.description,
       p.working_directory,
       p.created_by,
       p.archived_at,
       p.created_at,
       p.updated_at
     FROM projects p
     JOIN team_members tm
       ON tm.team_id = p.team_id
      AND tm.user_id = $2
     WHERE p.id = $1`,
    [projectId, actorUserId],
  );

  return result.rows[0];
}

async function requireTeamAccess(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  teamId: string,
) {
  const actorUserId = await requireActiveActor(app, request, reply);
  if (!actorUserId) {
    return null;
  }

  const team = await loadTeamForActor(app, teamId, actorUserId);
  if (!team) {
    reply.code(404).send({ code: "TEAM_NOT_FOUND" });
    return null;
  }

  return {
    actorUserId,
    team,
  };
}

async function requireProjectAccess(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string,
) {
  const actorUserId = await requireActiveActor(app, request, reply);
  if (!actorUserId) {
    return null;
  }

  const project = await loadProjectForActor(app, projectId, actorUserId);
  if (!project) {
    reply.code(404).send({ code: "PROJECT_NOT_FOUND" });
    return null;
  }

  return {
    actorUserId,
    project,
  };
}

export async function registerTeamRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/teams", async (request, reply) => {
    const actorUserId = await requireActiveActor(app, request, reply);
    if (!actorUserId) {
      return;
    }

    const body = teamCreateSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const client = await app.db.connect();

    try {
      await client.query("BEGIN");

      const teamResult = await client.query(
        `INSERT INTO teams (name, slug, created_by)
         VALUES ($1, $2, $3)
         RETURNING
           id,
           name,
           slug,
           default_agent_type,
           created_by,
           created_at,
           updated_at`,
        [body.data.name, body.data.slug, actorUserId],
      );
      const team = teamResult.rows[0];

      await client.query(
        `INSERT INTO team_members (team_id, user_id, role, invited_by)
         VALUES ($1, $2, 'admin', $2)`,
        [team.id, actorUserId],
      );

      await client.query("COMMIT");

      return reply.code(201).send({
        data: serializeTeam({
          ...team,
          member_role: "admin",
        }),
      });
    } catch (error) {
      await client.query("ROLLBACK");

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        return reply.code(409).send({ code: "TEAM_SLUG_ALREADY_EXISTS" });
      }

      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/teams", async (request, reply) => {
    const actorUserId = await requireActiveActor(app, request, reply);
    if (!actorUserId) {
      return;
    }

    const result = await app.db.query(
      `SELECT
         t.id,
         t.name,
         t.slug,
         t.default_agent_type,
         t.created_by,
         t.created_at,
         t.updated_at,
         tm.role AS member_role
       FROM teams t
       JOIN team_members tm
         ON tm.team_id = t.id
       WHERE tm.user_id = $1
       ORDER BY t.created_at DESC, t.id DESC`,
      [actorUserId],
    );

    return reply.code(200).send({
      data: result.rows.map(serializeTeam),
    });
  });

  app.get("/teams/:teamId", async (request, reply) => {
    const params = teamParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const access = await requireTeamAccess(
      app,
      request,
      reply,
      params.data.teamId,
    );
    if (!access) {
      return;
    }

    return reply.code(200).send({
      data: serializeTeam(access.team),
    });
  });

  app.get("/teams/:teamId/members", async (request, reply) => {
    const params = teamParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const access = await requireTeamAccess(
      app,
      request,
      reply,
      params.data.teamId,
    );
    if (!access) {
      return;
    }

    const result = await app.db.query(
      `SELECT
         tm.user_id,
         u.email,
         u.display_name,
         tm.role,
         tm.joined_at,
         (t.created_by = tm.user_id) AS is_creator
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.team_id = $1
       ORDER BY tm.joined_at ASC`,
      [params.data.teamId],
    );

    return reply.code(200).send({
      data: result.rows.map((row) => ({
        user_id: row.user_id,
        email: row.email,
        display_name: row.display_name,
        role: row.role,
        is_creator: Boolean(row.is_creator),
        joined_at: asIso(row.joined_at),
      })),
    });
  });

  app.post("/teams/:teamId/members", async (request, reply) => {
    const params = teamParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = teamMemberCreateSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const access = await requireTeamAccess(
      app,
      request,
      reply,
      params.data.teamId,
    );
    if (!access) {
      return;
    }

    if (access.team.member_role !== "admin") {
      return reply.code(403).send({ code: "TEAM_FORBIDDEN" });
    }

    // Resolve the target user_id (from email or direct user_id)
    let resolvedUserId: string;
    if (body.data.email) {
      const userByEmail = await app.db.query(
        `SELECT id FROM users WHERE email = $1 AND status = 'active'`,
        [body.data.email],
      );
      if (!userByEmail.rows[0]) {
        return reply.code(404).send({ code: "USER_NOT_FOUND" });
      }
      resolvedUserId = userByEmail.rows[0].id;
    } else {
      const targetUser = await loadActiveUser(app, body.data.user_id!);
      if (!targetUser) {
        return reply.code(404).send({ code: "USER_NOT_FOUND" });
      }
      resolvedUserId = body.data.user_id!;
    }

    try {
      const result = await app.db.query(
        `INSERT INTO team_members (team_id, user_id, role, invited_by)
         VALUES ($1, $2, $3, $4)
         RETURNING team_id, user_id, role, joined_at, invited_by`,
        [
          params.data.teamId,
          resolvedUserId,
          body.data.role,
          access.actorUserId,
        ],
      );

      return reply.code(201).send({
        data: serializeTeamMember(result.rows[0]),
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        return reply.code(409).send({ code: "TEAM_MEMBER_ALREADY_EXISTS" });
      }

      throw error;
    }
  });

  app.patch("/teams/:teamId/members/:userId", async (request, reply) => {
    const params = teamMemberParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = teamMemberPatchSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const access = await requireTeamAccess(
      app,
      request,
      reply,
      params.data.teamId,
    );
    if (!access) {
      return;
    }

    if (access.team.member_role !== "admin") {
      return reply.code(403).send({ code: "TEAM_FORBIDDEN" });
    }

    const result = await app.db.query(
      `UPDATE team_members
       SET role = $3
       WHERE team_id = $1
         AND user_id = $2
       RETURNING team_id, user_id, role, joined_at, invited_by`,
      [params.data.teamId, params.data.userId, body.data.role],
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ code: "TEAM_MEMBER_NOT_FOUND" });
    }

    return reply.code(200).send({
      data: serializeTeamMember(result.rows[0]),
    });
  });

  app.get("/teams/:teamId/agent-node", async (request, reply) => {
    const params = teamParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const access = await requireTeamAccess(
      app,
      request,
      reply,
      params.data.teamId,
    );
    if (!access) {
      return;
    }

    const result = await app.db.query(
      `SELECT
         id,
         team_id,
         owner_user_id,
         agent_type,
         node_mode,
         display_name,
         connection_status,
         client_fingerprint,
         last_heartbeat_at,
         metadata,
         created_at,
         updated_at
       FROM team_agent_nodes
       WHERE team_id = $1
         AND agent_type = 'codex'`,
      [params.data.teamId],
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ code: "NODE_NOT_CONFIGURED" });
    }

    return reply.code(200).send({
      data: serializeAgentNode(result.rows[0]),
    });
  });

  app.put("/teams/:teamId/agent-node", async (request, reply) => {
    const params = teamParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = agentNodeUpsertSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const access = await requireTeamAccess(
      app,
      request,
      reply,
      params.data.teamId,
    );
    if (!access) {
      return;
    }

    if (access.team.member_role !== "admin") {
      return reply.code(403).send({ code: "TEAM_FORBIDDEN" });
    }

    const result = await app.db.query(
      `INSERT INTO team_agent_nodes (
         team_id,
         owner_user_id,
         display_name,
         connection_status,
         last_heartbeat_at,
         client_fingerprint,
         metadata
       )
       VALUES ($1, $2, $3, 'online', now(), $4, '{}'::jsonb)
       ON CONFLICT (team_id, agent_type)
       DO UPDATE
       SET owner_user_id = EXCLUDED.owner_user_id,
           display_name = EXCLUDED.display_name,
           connection_status = 'online',
           last_heartbeat_at = now(),
           client_fingerprint = EXCLUDED.client_fingerprint,
           metadata = EXCLUDED.metadata,
           updated_at = now()
       RETURNING
         id,
         team_id,
         owner_user_id,
         agent_type,
         node_mode,
         display_name,
         connection_status,
         client_fingerprint,
         last_heartbeat_at,
         metadata,
         created_at,
         updated_at`,
      [
        params.data.teamId,
        access.actorUserId,
        body.data.display_name,
        body.data.client_fingerprint,
      ],
    );

    return reply.code(200).send({
      data: serializeAgentNode(result.rows[0]),
    });
  });

  app.post("/teams/:teamId/projects", async (request, reply) => {
    const params = teamParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = projectCreateSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const access = await requireTeamAccess(
      app,
      request,
      reply,
      params.data.teamId,
    );
    if (!access) {
      return;
    }

    const result = await app.db.query(
      `INSERT INTO projects (team_id, name, description, working_directory, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id,
         team_id,
         name,
         description,
         working_directory,
         created_by,
         archived_at,
         created_at,
         updated_at`,
      [
        params.data.teamId,
        body.data.name,
        body.data.description ?? null,
        body.data.working_directory ?? null,
        access.actorUserId,
      ],
    );

    return reply.code(201).send({
      data: serializeProject(result.rows[0]),
    });
  });

  app.get("/teams/:teamId/projects", async (request, reply) => {
    const params = teamParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const access = await requireTeamAccess(
      app,
      request,
      reply,
      params.data.teamId,
    );
    if (!access) {
      return;
    }

    const result = await app.db.query(
      `SELECT
         id,
         team_id,
         name,
         description,
         working_directory,
         created_by,
         archived_at,
         created_at,
         updated_at
       FROM projects
       WHERE team_id = $1
         AND archived_at IS NULL
       ORDER BY created_at DESC, id DESC`,
      [params.data.teamId],
    );

    return reply.code(200).send({
      data: result.rows.map(serializeProject),
    });
  });

  app.patch("/projects/:projectId/archive", async (request, reply) => {
    const params = projectParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = projectArchiveSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const access = await requireProjectAccess(
      app,
      request,
      reply,
      params.data.projectId,
    );
    if (!access) {
      return;
    }

    const result = await app.db.query(
      `UPDATE projects
       SET archived_at = CASE
            WHEN $2::boolean THEN now()
            ELSE NULL
           END,
           updated_at = now()
       WHERE id = $1
       RETURNING
         id,
         team_id,
         name,
         description,
         working_directory,
         created_by,
         archived_at,
         created_at,
         updated_at`,
      [params.data.projectId, body.data.archived],
    );

    return reply.code(200).send({
      data: serializeProject(result.rows[0]),
    });
  });
}
