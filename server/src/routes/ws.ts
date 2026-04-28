import { WebSocket, WebSocketServer } from "ws";
import type { FastifyInstance } from "fastify";
import { verifyAccessToken } from "../lib/auth.js";

interface ClientSubscribeMessage {
  type: string;
  sessionId?: string;
}

const WS_PATH = "/api/v1/ws";

export function registerWsRoute(app: FastifyInstance): void {
  const wss = new WebSocketServer({ noServer: true });

  // sessionId → Set<WebSocket>
  const subscribers = new Map<string, Set<WebSocket>>();

  app.server.on("upgrade", (request, socket, head) => {
    let pathname: string;
    let searchParams: URLSearchParams;

    try {
      // request.url may be a relative path (e.g. "/api/v1/ws?token=...")
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`,
      );
      pathname = url.pathname;
      searchParams = url.searchParams;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== WS_PATH) {
      // Not a websocket path — let Fastify handle it
      return;
    }

    const token = searchParams.get("token");
    if (!token) {
      // Accept the upgrade but immediately close with auth error
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.close(4001, "Missing token");
      });
      return;
    }

    const payload = verifyAccessToken(token, app.config.authAccessSecret);
    if (!payload) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.close(4001, "Invalid or expired token");
      });
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const userId = payload.userId;

      ws.on("message", async (raw) => {
        let msg: ClientSubscribeMessage;

        try {
          msg = JSON.parse(raw.toString()) as ClientSubscribeMessage;
        } catch {
          return;
        }

        if (msg.type !== "subscribe" || !msg.sessionId) {
          return;
        }

        const sessionId = msg.sessionId;

        try {
          // Verify session exists, is not archived, and user can access it
          const sessionResult = await app.db.query(
            `SELECT s.id, s.visibility, s.creator_id, p.team_id
             FROM sessions s
             JOIN projects p ON p.id = s.project_id
             WHERE s.id = $1
               AND s.archived_at IS NULL
               AND p.archived_at IS NULL`,
            [sessionId],
          );

          const session = sessionResult.rows[0];
          if (!session) {
            ws.close(4004, "Session not found");
            return;
          }

          // Check team membership
          const memberResult = await app.db.query(
            `SELECT 1
             FROM team_members
             WHERE team_id = $1
               AND user_id = $2
             LIMIT 1`,
            [session.team_id, userId],
          );

          if (!memberResult.rows[0]) {
            ws.close(4003, "Not a team member");
            return;
          }

          // Check session visibility
          if (
            session.visibility !== "shared" &&
            String(session.creator_id) !== userId
          ) {
            ws.close(4003, "Session not visible");
            return;
          }

          // Add to subscribers
          let set = subscribers.get(sessionId);
          if (!set) {
            set = new Set();
            subscribers.set(sessionId, set);
          }
          set.add(ws);

          // Clean up on close
          ws.on("close", () => {
            const current = subscribers.get(sessionId);
            if (current) {
              current.delete(ws);
              if (current.size === 0) {
                subscribers.delete(sessionId);
              }
            }
          });
        } catch {
          ws.close(4002, "Internal error during subscription");
        }
      });
    });
  });

  // Listen for workspace runtime events and fan-out to subscribers
  app.workspaceRuntime.on("message.new", (event) => {
    const set = subscribers.get(event.sessionId);
    if (!set) {
      return;
    }

    const payload = JSON.stringify({
      type: "message.new",
      data: { message: event.message },
    });

    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  });

  app.workspaceRuntime.on("status.changed", (event) => {
    const set = subscribers.get(event.sessionId);
    if (!set) {
      return;
    }

    const payload = JSON.stringify({
      type: "status.changed",
      data: { runtime_status: event.runtimeStatus },
    });

    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  });

  app.log.info("WebSocket route registered on %s", WS_PATH);
}
