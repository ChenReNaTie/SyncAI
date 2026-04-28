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

import type { Message } from "./client.js";

export interface SocketMessageEvent {
  type: "message.new";
  data: {
    message: {
      id: string;
      content: string;
      sender: string;
      session_id: string;
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

export function createSessionSocket(
  token: string,
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
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  // In dev mode, connect through Vite proxy (which now has ws: true).
  // In production, connect to the same host (Nginx or direct).
  const wsHost = window.location.host;
  const url = `${protocol}://${wsHost}/api/v1/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);

  // Track pending subscriptions that arrive before the socket opens.
  const pendingSubscriptions: string[] = [];
  if (autoSubscribeSessionId) {
    pendingSubscriptions.push(autoSubscribeSessionId);
  }

  // Whether close() was called — used to avoid racing CONNECTING → OPEN.
  let closed = false;

  ws.addEventListener("open", () => {
    // If close() was called while the socket was CONNECTING, shut it down now.
    if (closed) {
      ws.close();
      return;
    }
    // Flush any pending subscriptions.
    for (const sid of pendingSubscriptions) {
      ws.send(JSON.stringify({ type: "subscribe", sessionId: sid }));
    }
    pendingSubscriptions.length = 0;
  });

  ws.addEventListener("message", (event: MessageEvent) => {
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

  ws.addEventListener("error", (event: Event) => {
    handlers.onError?.(event);
  });

  ws.addEventListener("close", (event: CloseEvent) => {
    handlers.onClose?.(event);
  });

  return {
    subscribe(sessionId: string) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "subscribe", sessionId }));
      } else {
        // Socket not open yet — queue for later delivery.
        pendingSubscriptions.push(sessionId);
      }
    },
    close() {
      closed = true;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
        ws.close();
      }
      // If still CONNECTING the open handler will close it.
    },
  };
}
