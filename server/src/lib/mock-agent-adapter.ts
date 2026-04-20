import { randomUUID } from "node:crypto";

function sleep(durationMs: number) {
  if (durationMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function normalizeContent(content: string) {
  return content.trim().replace(/\s+/g, " ");
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

export class MockAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockAgentError";
  }
}

export interface StartSessionInput {
  teamId: string;
  sessionId: string;
  nodeId: string;
}

export interface SendMessageInput {
  sessionId: string;
  messageId: string;
  content: string;
}

export interface MockAgentResult {
  summary: string;
  finalReply: string;
}

export interface MockAgentAdapter {
  startSession(input: StartSessionInput): Promise<{ agentSessionRef: string }>;
  sendMessage(input: SendMessageInput): Promise<MockAgentResult>;
}

export function createMockAgentAdapter(options: {
  latencyMs?: number;
} = {}): MockAgentAdapter {
  const latencyMs = Math.max(0, options.latencyMs ?? 25);

  return {
    async startSession(input) {
      return {
        agentSessionRef: truncate(
          `mock-codex-${input.teamId}-${input.nodeId}-${input.sessionId}-${randomUUID()}`,
          255,
        ),
      };
    },

    async sendMessage(input) {
      await sleep(latencyMs);

      const normalized = normalizeContent(input.content);

      if (/\[mock-fail\]/iu.test(normalized)) {
        throw new MockAgentError(
          `Mock Codex failed while processing: ${truncate(normalized, 120)}`,
        );
      }

      return {
        summary: `Mock Codex reviewed the member request: ${truncate(normalized, 160)}`,
        finalReply: `Mock Codex completed the request: ${normalized}`,
      };
    },
  };
}
