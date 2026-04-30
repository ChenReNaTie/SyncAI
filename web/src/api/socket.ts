/**
 * WebSocket client for real-time session events.
 *
 * Protocol:
 *   - Connect: ws(s)://<host>/api/v1/ws?token=<jwt>
 *   - Subscribe: { type: "subscribe", sessionId: "<uuid>" }
 *   - Inbound:  { type: "message.new", data: { message: Message } }
 *   - Inbound:  { type: "status.changed", data: { runtime_status: string } }
 *   - Inbound:  { type: "stream.event", data: { sessionId, event: StreamEvent } }
 */

import {
  getStoredAccessToken,
  refreshAccessToken,
} from "./client.js";
import type { Message } from "./client.js";

export interface SocketMessageEvent {
  type: "message.new";
  data: {
    message: {
      id: string;
      content: string;
      sender: string;
      sender_type?: "member" | "agent";
      sender_user_id?: string | null;
      sender_display_name?: string;
      session_id: string;
      processing_status?: string;
      is_final_reply?: boolean;
      metadata?: Record<string, unknown>;
      created_at: string;
    };
  };
}

export interface SocketStatusEvent {
  type: "status.changed";
  data: {
    runtime_status: string;
  };
}

/** A single stream event from the Codex agent. */
export interface SocketStreamEvent {
  type: "stream.event";
  data: {
    sessionId: string;
    event: {
      type: string;
      data: Record<string, unknown>;
    };
  };
}

export type SocketEvent =
  | SocketMessageEvent
  | SocketStatusEvent
  | SocketStreamEvent;

export interface SessionSocket {
  /** Send a subscribe message for a given session. */
  subscribe(sessionId: string): void;
  /** Close the connection. */
  close(): void;
}

function buildSocketUrl(token: string) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const wsHost = window.location.host;
  return `${protocol}://${wsHost}/api/v1/ws?token=${encodeURIComponent(token)}`;
}

async function resolveSocketAccessToken(forceRefresh = false) {
  if (forceRefresh) {
    return refreshAccessToken();
  }

  return getStoredAccessToken() ?? refreshAccessToken();
}

export function createSessionSocket(
  handlers: {
    onMessage: (msg: Message) => void;
    onStatusChanged: (status: string) => void;
    onStreamEvent?: (event: SocketStreamEvent["data"]["event"]) => void;
    onError?: (error: Event) => void;
    onClose?: (event: CloseEvent) => void;
  },
  /** If provided, the socket auto-subscribes to this session as soon as it opens. */
  autoSubscribeSessionId?: string,
): SessionSocket {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnecting = false;
  const subscriptions = new Set<string>();

  if (autoSubscribeSessionId) {
    subscriptions.add(autoSubscribeSessionId);
  }

  const connect = async (forceRefresh = false) => {
    if (closed) {
      return;
    }

    const token = await resolveSocketAccessToken(forceRefresh);
    if (!token || closed) {
      handlers.onClose?.(new CloseEvent("close", {
        code: 4001,
        reason: "Authentication unavailable",
      }));
      return;
    }

    const socket = new WebSocket(buildSocketUrl(token));
    ws = socket;

    socket.addEventListener("open", () => {
      if (closed || socket !== ws) {
        socket.close();
        return;
      }

      for (const sessionId of subscriptions) {
        socket.send(JSON.stringify({ type: "subscribe", sessionId }));
      }
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as SocketEvent;

        if (payload.type === "message.new" && payload.data?.message) {
          const raw = payload.data.message;
          const msg: Message = {
            id: raw.id,
            content: raw.content,
            sender: raw.sender,
            session_id: raw.session_id,
            created_at: raw.created_at,
            ...(raw.sender_type !== undefined
              ? { sender_type: raw.sender_type }
              : {}),
            ...(raw.sender_user_id !== undefined
              ? { sender_user_id: raw.sender_user_id }
              : {}),
            ...(raw.sender_display_name !== undefined
              ? { sender_display_name: raw.sender_display_name }
              : {}),
            ...(raw.processing_status !== undefined
              ? { processing_status: raw.processing_status }
              : {}),
            ...(raw.is_final_reply !== undefined
              ? { is_final_reply: raw.is_final_reply }
              : {}),
            ...(raw.metadata !== undefined
              ? { metadata: raw.metadata }
              : {}),
          };
          handlers.onMessage(msg);
        }

        if (payload.type === "status.changed" && payload.data?.runtime_status) {
          handlers.onStatusChanged(payload.data.runtime_status);
        }

        if (payload.type === "stream.event" && payload.data?.event) {
          handlers.onStreamEvent?.(payload.data.event);
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    socket.addEventListener("error", (event: Event) => {
      if (socket !== ws) {
        return;
      }
      handlers.onError?.(event);
    });

    socket.addEventListener("close", (event: CloseEvent) => {
      if (socket !== ws) {
        return;
      }

      ws = null;

      if (closed) {
        handlers.onClose?.(event);
        return;
      }

      if (event.code === 4001 && !reconnecting) {
        reconnecting = true;
        void (async () => {
          try {
            const nextToken = await refreshAccessToken();
            if (!nextToken || closed) {
              handlers.onClose?.(event);
              return;
            }
            await connect(false);
          } finally {
            reconnecting = false;
          }
        })();
        return;
      }

      handlers.onClose?.(event);
    });
  };

  void connect(false);

  return {
    subscribe(sessionId: string) {
      subscriptions.add(sessionId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "subscribe", sessionId }));
      }
    },
    close() {
      closed = true;
      reconnecting = false;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      ws = null;
    },
  };
}
