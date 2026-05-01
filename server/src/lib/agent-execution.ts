export interface AgentUsageTrace {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
}

export interface AgentRuntimeInfo {
  thread_id?: string;
  model?: string | null;
  model_provider?: string | null;
  reasoning_effort?: string | null;
  approval_policy?: string | null;
  sandbox_mode?: string | null;
  network_access?: boolean | null;
  branch?: string | null;
  working_directory?: string | null;
  cli_version?: string | null;
  source?: string | null;
}

export interface AgentSessionConfig {
  model?: string | null;
  reasoning_effort?: string | null;
  approval_policy?: string | null;
  sandbox_mode?: string | null;
  branch?: string | null;
}

export interface AgentCommandTrace {
  command: string;
  cwd?: string | null;
  output?: string | null;
  exit_code?: number | null;
  status: string;
  duration_ms?: number | null;
}

export interface AgentFileTrace {
  path: string;
  kind: "add" | "delete" | "update";
}

export interface AgentFileDiffTrace extends AgentFileTrace {
  patch: string;
}

export interface AgentExecutionTrace {
  commands: AgentCommandTrace[];
  files: AgentFileTrace[];
  file_diffs: AgentFileDiffTrace[];
}

export interface AgentMessageMetadataShape {
  codex_runtime?: AgentRuntimeInfo;
  execution_trace?: AgentExecutionTrace;
  usage?: AgentUsageTrace;
}
