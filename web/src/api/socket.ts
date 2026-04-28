/**
 * WebSocket client for real-time session events.
 *
 * Protocol:
 *   - Connect: ws(s)://<host>/api/v1/ws?token=<jwt>
 *   - Subscribe: { type: "subscribe", sessionId: "<uuid>" }
 *   - Inbound:  { type: "message.new", data: { message: Message } }
 *   - Inbound:  { type: "status.changed", data: { runtime_status: string } }
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

export type SocketEvent = SocketMessageEvent | SocketStatusEvent;

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
    onError?: (error: Event) => void;
    onClose?: (event: CloseEvent) => void;
  },
): SessionSocket {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${protocol}://${window.location.host}/api/v1/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    // connection established; subscriptions are sent by the caller
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
      }
    },
    close() {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    },
  };
}
