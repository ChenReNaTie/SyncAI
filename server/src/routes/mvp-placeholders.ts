import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type PlaceholderParams = {
  contractId: string;
  method: string;
  path: string;
};

function sendPlaceholder(reply: FastifyReply, params: PlaceholderParams) {
  return reply.code(501).send({
    code: "NOT_IMPLEMENTED",
    contractId: params.contractId,
    message: `${params.method} ${params.path} is wired but not implemented yet.`,
  });
}

export async function registerMvpPlaceholderRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/projects/:projectId/sessions",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_session_create_visibility",
        method: "POST",
        path: "/api/v1/projects/:projectId/sessions",
      }),
  );

  app.get(
    "/projects/:projectId/sessions",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_session_create_visibility",
        method: "GET",
        path: "/api/v1/projects/:projectId/sessions",
      }),
  );

  app.get(
    "/sessions/:sessionId",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_session_create_visibility",
        method: "GET",
        path: "/api/v1/sessions/:sessionId",
      }),
  );

  app.patch(
    "/sessions/:sessionId/visibility",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_session_create_visibility",
        method: "PATCH",
        path: "/api/v1/sessions/:sessionId/visibility",
      }),
  );

  app.post(
    "/sessions/:sessionId/messages",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_message_submit_idempotency",
        method: "POST",
        path: "/api/v1/sessions/:sessionId/messages",
      }),
  );

  app.get(
    "/sessions/:sessionId/replay",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_replay_scope",
        method: "GET",
        path: "/api/v1/sessions/:sessionId/replay",
      }),
  );

  app.get(
    "/sessions/:sessionId/todos",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_todo_and_audit",
        method: "GET",
        path: "/api/v1/sessions/:sessionId/todos",
      }),
  );

  app.post(
    "/sessions/:sessionId/todos",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_todo_and_audit",
        method: "POST",
        path: "/api/v1/sessions/:sessionId/todos",
      }),
  );

  app.patch(
    "/todos/:todoId",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_todo_and_audit",
        method: "PATCH",
        path: "/api/v1/todos/:todoId",
      }),
  );

  app.get(
    "/sessions/:sessionId/audit-logs",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_todo_and_audit",
        method: "GET",
        path: "/api/v1/sessions/:sessionId/audit-logs",
      }),
  );

  app.get(
    "/teams/:teamId/search",
    async (_request: FastifyRequest, reply): Promise<FastifyReply> =>
      sendPlaceholder(reply, {
        contractId: "contract_search_scope",
        method: "GET",
        path: "/api/v1/teams/:teamId/search",
      }),
  );
}
