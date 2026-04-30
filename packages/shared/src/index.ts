export const AGENT_TYPE = "codex" as const;

export const sessionVisibilityValues = ["shared", "private"] as const;
export type SessionVisibility = (typeof sessionVisibilityValues)[number];

export const sessionRuntimeStatusValues = [
  "idle",
  "queued",
  "running",
  "completed",
  "error",
] as const;
export type SessionRuntimeStatus = (typeof sessionRuntimeStatusValues)[number];

export const messageProcessingStatusValues = [
  "accepted",
  "queued",
  "running",
  "completed",
  "failed",
] as const;
export type MessageProcessingStatus =
  (typeof messageProcessingStatusValues)[number];

export const senderTypeValues = ["member", "agent"] as const;
export type SenderType = (typeof senderTypeValues)[number];

export const todoStatusValues = ["pending", "completed"] as const;
export type TodoStatus = (typeof todoStatusValues)[number];

export const sessionEventTypeValues = [
  "status.changed",
  "command.summary",
  "message.queued",
  "session.shared",
  "session.privatized",
  "message.failed",
  "node.status_changed",
] as const;
export type SessionEventType = (typeof sessionEventTypeValues)[number];

export interface Team {
  id: string;
  name: string;
  slug: string;
  defaultAgentType: typeof AGENT_TYPE;
}

export interface Project {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  archivedAt?: string | null;
}

export interface Session {
  id: string;
  projectId: string;
  creatorId: string;
  title: string;
  visibility: SessionVisibility;
  runtimeStatus: SessionRuntimeStatus;
  boundAgentType: typeof AGENT_TYPE;
  boundAgentSessionRef?: string | null;
}

export interface Message {
  id: string;
  sessionId: string;
  senderType: SenderType;
  senderUserId?: string | null;
  senderDisplayName: string;
  content: string;
  processingStatus: MessageProcessingStatus;
  isFinalReply: boolean;
  createdAt: string;
}

export interface Todo {
  id: string;
  sessionId: string;
  sourceMessageId: string;
  title: string;
  status: TodoStatus;
}

export interface AppHealth {
  name: string;
  version: string;
  agentType: typeof AGENT_TYPE;
  stage: "phase-0";
  runtime: {
    node: string;
    timestamp: string;
  };
}

