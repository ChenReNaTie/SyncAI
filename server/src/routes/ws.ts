import { WebSocket, WebSocketServer } from "ws";
import type { FastifyInstance } from "fastify";
import { verifyAccessToken } from "../lib/auth.js";

interface ClientSubscribeMessage {
  type: string;
  sessionId?: string;
  requestId?: string;
  decision?: string;
}

const WS_PATH = "/api/v1/ws";

let registered = false;

export function registerWsRoute(app: FastifyInstance): void {
  if (registered) {
    return;
  }

  if (!app.server) {
    app.log.warn(
      "registerWsRoute called before server is ready; skipping"
    );
    return;
  }

  registered = true;

  const wss = new WebSocketServer({ noServer: true });

  // sessionId → Set<WebSocket>
  const subscribers = new Map<string, Set<WebSocket>>();
  const subscriptionsBySocket = new Map<WebSocket, Set<string>>();

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

        if (msg.type === "approval.respond") {
          if (
            !msg.sessionId
            || !msg.requestId
            || (msg.decision !== "accept" && msg.decision !== "decline")
          ) {
            return;
          }

          const socketSessions = subscriptionsBySocket.get(ws);
          if (!socketSessions?.has(msg.sessionId)) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "approval.error",
                data: {
                  sessionId: msg.sessionId,
                  requestId: msg.requestId,
                  message: "Session subscription is required before responding to approvals.",
                },
              }));
            }
            return;
          }

          const resolved = await app.workspaceRuntime.resolveApproval({
            sessionId: msg.sessionId,
            requestId: msg.requestId,
            decision: msg.decision,
          });

          if (!resolved && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "approval.error",
              data: {
                sessionId: msg.sessionId,
                requestId: msg.requestId,
                message: "Approval request is no longer pending.",
              },
            }));
          }
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
          let socketSessions = subscriptionsBySocket.get(ws);
          if (!socketSessions) {
            socketSessions = new Set();
            subscriptionsBySocket.set(ws, socketSessions);
          }
          socketSessions.add(sessionId);

          // Clean up on close
          ws.on("close", () => {
            const current = subscribers.get(sessionId);
            if (current) {
              current.delete(ws);
              if (current.size === 0) {
                subscribers.delete(sessionId);
              }
            }
            const knownSessions = subscriptionsBySocket.get(ws);
            if (knownSessions) {
              knownSessions.delete(sessionId);
              if (knownSessions.size === 0) {
                subscriptionsBySocket.delete(ws);
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

  // Forward stream events from Codex adapter to WebSocket subscribers
  app.workspaceRuntime.on("stream.event", (event) => {
    const set = subscribers.get(event.sessionId);
    if (!set) {
      return;
    }

    const payload = JSON.stringify({
      type: "stream.event",
      data: {
        sessionId: event.sessionId,
        event: event.event,
      },
    });

    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  });

  app.log.info("WebSocket route registered on %s", WS_PATH);
}
