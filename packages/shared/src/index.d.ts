export declare const AGENT_TYPE: "codex";
export declare const sessionVisibilityValues: readonly ["shared", "private"];
export type SessionVisibility = (typeof sessionVisibilityValues)[number];
export declare const sessionRuntimeStatusValues: readonly ["idle", "queued", "running", "completed", "error"];
export type SessionRuntimeStatus = (typeof sessionRuntimeStatusValues)[number];
export declare const messageProcessingStatusValues: readonly ["accepted", "queued", "running", "completed", "failed"];
export type MessageProcessingStatus = (typeof messageProcessingStatusValues)[number];
export declare const senderTypeValues: readonly ["member", "agent"];
export type SenderType = (typeof senderTypeValues)[number];
export declare const todoStatusValues: readonly ["pending", "completed"];
export type TodoStatus = (typeof todoStatusValues)[number];
export declare const sessionEventTypeValues: readonly ["status.changed", "command.summary", "message.queued", "session.shared", "session.privatized", "message.failed", "node.status_changed"];
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
