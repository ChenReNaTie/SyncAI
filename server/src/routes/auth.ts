import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  hashPassword,
  issueTokenPair,
  verifyAccessToken,
  verifyPassword,
} from "../lib/auth.js";

const registerSchema = z.object({
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(200),
  display_name: z.string().trim().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200),
});

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

function serializeUser(row: Record<string, unknown>) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
  };
}

function createAuthEnvelope(
  user: Record<string, unknown>,
  tokens: {
    accessToken: string;
    refreshToken: string;
  },
) {
  return {
    data: {
      user: serializeUser(user),
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    },
  };
}

async function loadActiveUser(app: FastifyInstance, userId: string) {
  const result = await app.db.query(
    `SELECT id, email, display_name, status
     FROM users
     WHERE id = $1`,
    [userId],
  );

  const user = result.rows[0];
  if (!user || user.status !== "active") {
    return null;
  }

  return user;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const passwordHash = await hashPassword(body.data.password);

    try {
      const result = await app.db.query(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, display_name`,
        [body.data.email, passwordHash, body.data.display_name],
      );
      const user = result.rows[0];
      const tokens = issueTokenPair({
        userId: String(user.id),
        accessSecret: app.config.authAccessSecret,
        refreshSecret: app.config.authRefreshSecret,
        accessTtlSeconds: app.config.authAccessTtlSeconds,
        refreshTtlSeconds: app.config.authRefreshTtlSeconds,
      });

      return reply.code(201).send(createAuthEnvelope(user, tokens));
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        return reply.code(409).send({ code: "EMAIL_ALREADY_EXISTS" });
      }

      throw error;
    }
  });

  app.post("/auth/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const result = await app.db.query(
      `SELECT id, email, display_name, password_hash, status
       FROM users
       WHERE email = $1`,
      [body.data.email],
    );
    const user = result.rows[0];

    if (
      !user ||
      user.status !== "active" ||
      !(await verifyPassword(body.data.password, String(user.password_hash)))
    ) {
      return reply.code(401).send({ code: "INVALID_CREDENTIALS" });
    }

    const updated = await app.db.query(
      `UPDATE users
       SET last_login_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name`,
      [user.id],
    );
    const tokens = issueTokenPair({
      userId: String(user.id),
      accessSecret: app.config.authAccessSecret,
      refreshSecret: app.config.authRefreshSecret,
      accessTtlSeconds: app.config.authAccessTtlSeconds,
      refreshTtlSeconds: app.config.authRefreshTtlSeconds,
    });

    return reply.code(200).send(createAuthEnvelope(updated.rows[0], tokens));
  });

  app.get("/auth/me", async (request, reply) => {
    const bearerToken = getAuthorizationBearerToken(request);
    if (!bearerToken) {
      return sendAuthRequired(reply);
    }

    const token = verifyAccessToken(
      bearerToken,
      app.config.authAccessSecret,
    );
    if (!token) {
      return sendAuthRequired(reply);
    }

    const user = await loadActiveUser(app, token.userId);
    if (!user) {
      return sendAuthRequired(reply);
    }

    return reply.code(200).send({
      data: serializeUser(user),
    });
  });
}
