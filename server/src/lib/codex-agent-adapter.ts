import { Codex } from "@openai/codex-sdk";
import type {
  MockAgentAdapter,
  MockAgentResult,
  StreamEvent,
  StartSessionInput,
  SendMessageInput,
} from "./mock-agent-adapter.js";

interface CodexSessionState {
  threadId: string;
  workingDirectory: string;
}

export function createCodexAgentAdapter(options: {
  codexPath?: string;
} = {}): MockAgentAdapter {
  const codex = new Codex({
    codexPathOverride:
      options.codexPath ??
      "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe",
  });

  const sessions = new Map<string, CodexSessionState>();

  return {
    async startSession(input: StartSessionInput) {
      sessions.set(input.sessionId, {
        threadId: "",
        workingDirectory: input.workingDirectory ?? process.cwd(),
      });

      return { agentSessionRef: input.sessionId };
    },

    async *sendMessage(
      input: SendMessageInput,
    ): AsyncGenerator<StreamEvent, MockAgentResult, void> {
      let sessionState = sessions.get(input.sessionId);
      if (!sessionState) {
        // Lazy init: session was created before server restart or binding was lost
        const wd = input.workingDirectory ?? process.cwd();
        sessionState = { threadId: "", workingDirectory: wd };
        sessions.set(input.sessionId, sessionState);
      }

      const thread = sessionState.threadId
        ? codex.resumeThread(sessionState.threadId, {
            workingDirectory: sessionState.workingDirectory,
            skipGitRepoCheck: true,
          })
        : codex.startThread({
            workingDirectory: sessionState.workingDirectory,
            skipGitRepoCheck: true,
          });

      let finalResponse = "";

      const streamedTurn = await thread.runStreamed(input.content);

      for await (const event of streamedTurn.events) {
        // Forward every SDK event to the stream
        yield {
          type: event.type,
          data: event as unknown as Record<string, unknown>,
        };

        // Capture the thread ID from the first thread.started event
        if (
          event.type === "thread.started" &&
          !sessionState.threadId &&
          "thread_id" in event
        ) {
          sessionState.threadId = String(event.thread_id);
        }

        // Accumulate the final agent response
        if (
          event.type === "item.completed" &&
          "item" in event &&
          event.item &&
          typeof event.item === "object" &&
          "type" in event.item &&
          event.item.type === "agent_message" &&
          "text" in event.item
        ) {
          finalResponse = String(event.item.text);
        }
      }

      const summary = finalResponse.slice(0, 160);

      return {
        summary,
        finalReply: finalResponse || "Codex completed with no output.",
      };
    },
  };
}
