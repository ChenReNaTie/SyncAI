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
  workingDirectory?: string;
}

export interface SendMessageInput {
  sessionId: string;
  messageId: string;
  content: string;
  workingDirectory?: string;
}

export interface MockAgentResult {
  summary: string;
  finalReply: string;
}

export interface StreamEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface MockAgentAdapter {
  startSession(input: StartSessionInput): Promise<{ agentSessionRef: string }>;
  sendMessage(
    input: SendMessageInput,
  ): AsyncGenerator<StreamEvent, MockAgentResult, void>;
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

    async *sendMessage(input) {
      await sleep(latencyMs);

      const normalized = normalizeContent(input.content);

      if (/\[mock-fail\]/iu.test(normalized)) {
        throw new MockAgentError(
          `Mock Codex failed while processing: ${truncate(normalized, 120)}`,
        );
      }

      const finalText = `Mock Codex completed the request: ${normalized}`;

      yield {
        type: "thread.started",
        data: { thread_id: "mock-thread-001" },
      };
      yield { type: "turn.started", data: {} };

      // Simulate a command execution
      const cmdItem = {
        id: "mock-cmd-001",
        type: "command_execution",
        command: "ls -la",
        aggregated_output: "total 42\n-rw-r--r-- 1 user user 1234 file.txt",
        status: "in_progress",
      };
      yield {
        type: "item.started",
        data: { item: cmdItem },
      };
      yield {
        type: "item.completed",
        data: {
          item: { ...cmdItem, status: "completed", exit_code: 0 },
        },
      };

      // Simulate agent message (incremental)
      const msgItem = {
        id: "mock-msg-001",
        type: "agent_message",
        text: "",
      };
      yield {
        type: "item.started",
        data: { item: msgItem },
      };
      // Simulate text streaming
      for (let i = 0; i < Math.min(finalText.length, 4); i++) {
        const partial = finalText.slice(0, Math.ceil((finalText.length / 4) * (i + 1)));
        yield {
          type: "item.updated",
          data: {
            item: { ...msgItem, text: partial },
          },
        };
        await sleep(latencyMs * 2);
      }
      yield {
        type: "item.completed",
        data: {
          item: { ...msgItem, text: finalText },
        },
      };

      yield {
        type: "turn.completed",
        data: {
          usage: { input_tokens: 150, cached_input_tokens: 0, output_tokens: 80 },
        },
      };

      return {
        summary: `Mock Codex reviewed the member request: ${truncate(normalized, 160)}`,
        finalReply: finalText,
      };
    },
  };
}
