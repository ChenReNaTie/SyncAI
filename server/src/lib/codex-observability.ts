import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  AgentCommandTrace,
  AgentExecutionTrace,
  AgentFileDiffTrace,
  AgentFileTrace,
  AgentMessageMetadataShape,
  AgentRuntimeInfo,
  AgentUsageTrace,
} from "./agent-execution.js";

interface JsonlEntry {
  timestamp: string;
  type: string;
  payload?: Record<string, unknown>;
}

interface TurnWindow {
  threadId: string;
  workingDirectory?: string;
  runtime: AgentRuntimeInfo | null;
  commands: AgentCommandTrace[];
  files: AgentFileTrace[];
}

export interface WorkspaceSnapshot {
  workingDirectory?: string;
  gitRoot?: string;
  branch?: string | null;
  baselineRef?: string | null;
  untrackedBefore: Set<string>;
}

interface ParsedPatchSection {
  path: string;
  kind: "add" | "delete" | "update";
  patch: string;
}

export interface CodexModelCapability {
  slug: string;
  display_name?: string;
  default_reasoning_level?: string | null;
  supported_reasoning_levels: Array<{
    effort: string;
    description?: string;
  }>;
}

export interface CodexCliCapabilities {
  models: CodexModelCapability[];
  sandboxModes: string[];
  approvalPolicies: string[];
}

const COMMAND_OUTPUT_LIMIT = 12000;
const DIFF_PATCH_LIMIT = 20000;
const CODEX_CAPABILITIES_CACHE_TTL_MS = 30_000;

let codexCapabilitiesCache:
  | {
      expiresAt: number;
      value: CodexCliCapabilities;
    }
  | null = null;

function truncateText(value: string, limit: number) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n... [truncated]`;
}

function runGitCommand(cwd: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    return null;
  }

  return String(result.stdout ?? "").trim();
}

function runGitCommandRaw(cwd: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    return null;
  }

  return String(result.stdout ?? "");
}

function isDirectory(value: string) {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function toWorkspaceRelativePath(baseDirectory: string, targetPath: string) {
  if (!isAbsolute(targetPath)) {
    return targetPath.replace(/\\/gu, "/");
  }

  return relative(baseDirectory, targetPath).replace(/\\/gu, "/");
}

function parseTomlString(content: string, key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"\\s*$`, "m");
  const match = content.match(pattern);
  if (!match?.[1]) {
    return null;
  }

  return match[1].replace(/\\"/gu, "\"");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function splitPossibleValues(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqValues(values: Array<string | null | undefined>) {
  return [...new Set(
    values
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim()),
  )];
}

function runCodexCommand(args: string[]) {
  if (process.platform === "win32") {
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", `codex ${args.join(" ")}`], {
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.error || result.status !== 0) {
      return null;
    }

    return String(result.stdout ?? "");
  }

  const result = spawnSync("codex", args, {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return String(result.stdout ?? "");
}

function parseCodexModelCapabilities(output: string): CodexModelCapability[] {
  try {
    const parsed = JSON.parse(output) as { models?: unknown };
    if (!Array.isArray(parsed.models)) {
      return [];
    }

    return parsed.models.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const model = item as Record<string, unknown>;
      if (typeof model.slug !== "string" || model.slug.trim().length === 0) {
        return [];
      }

      const supportedReasoningLevels = Array.isArray(model.supported_reasoning_levels)
        ? model.supported_reasoning_levels.flatMap((level) => {
            if (typeof level === "string" && level.trim().length > 0) {
              return [{
                effort: level.trim(),
              }];
            }
            if (!level || typeof level !== "object") {
              return [];
            }

            const entry = level as Record<string, unknown>;
            if (typeof entry.effort !== "string" || entry.effort.trim().length === 0) {
              return [];
            }

            return [{
              effort: entry.effort.trim(),
              ...(typeof entry.description === "string" && entry.description.trim().length > 0
                ? { description: entry.description.trim() }
                : {}),
            }];
          })
        : [];

      return [{
        slug: model.slug.trim(),
        ...(typeof model.display_name === "string" && model.display_name.trim().length > 0
          ? { display_name: model.display_name.trim() }
          : {}),
        ...(typeof model.default_reasoning_level === "string"
          && model.default_reasoning_level.trim().length > 0
          ? { default_reasoning_level: model.default_reasoning_level.trim() }
          : {}),
        supported_reasoning_levels: supportedReasoningLevels,
      }];
    });
  } catch {
    return [];
  }
}

function parseInlinePossibleValues(helpText: string, optionSignature: string) {
  const pattern = new RegExp(
    `${escapeRegExp(optionSignature)}[\\s\\S]*?\\[possible values:\\s*([^\\]]+)\\]`,
    "u",
  );
  const match = helpText.match(pattern);
  return match?.[1] ? splitPossibleValues(match[1]) : [];
}

function parseBlockPossibleValues(helpText: string, optionSignature: string) {
  const startIndex = helpText.indexOf(optionSignature);
  if (startIndex < 0) {
    return [];
  }

  const section = helpText.slice(startIndex);
  return uniqValues(
    [...section.matchAll(/^\s+-\s+([a-z0-9-]+)\s*:/gimu)].map((match) => match[1] ?? null),
  );
}

function readCodexConfigContent() {
  const configPath = join(homedir(), ".codex", "config.toml");
  if (!existsSync(configPath)) {
    return null;
  }

  return readFileSync(configPath, "utf8");
}

export function readCodexConfigDefaults() {
  const content = readCodexConfigContent();
  if (!content) {
    return {
      model: null,
      modelProvider: null,
      reasoningEffort: null,
      approvalPolicy: null,
      sandboxMode: null,
    };
  }

  return {
    model: parseTomlString(content, "model"),
    modelProvider: parseTomlString(content, "model_provider"),
    reasoningEffort: parseTomlString(content, "model_reasoning_effort"),
    approvalPolicy:
      parseTomlString(content, "approval_policy")
      ?? parseTomlString(content, "ask_for_approval"),
    sandboxMode:
      parseTomlString(content, "sandbox_mode")
      ?? parseTomlString(content, "sandbox"),
  };
}

export function listConfiguredModels() {
  const content = readCodexConfigContent();
  if (!content) {
    return [];
  }

  const discovered = new Set<string>();

  for (const match of content.matchAll(/^\s*model\s*=\s*"([^"\r\n]+)"\s*$/gmu)) {
    if (match[1]) {
      discovered.add(match[1]);
    }
  }

  const availabilitySection = content.match(/\[tui\.model_availability_nux\]([\s\S]*)/u)?.[1] ?? "";
  for (const match of availabilitySection.matchAll(/^\s*"([^"\r\n]+)"\s*=\s*.+$/gmu)) {
    if (match[1]) {
      discovered.add(match[1]);
    }
  }

  return [...discovered].sort((left, right) => left.localeCompare(right));
}

export function getCodexCliCapabilities() {
  const now = Date.now();
  if (codexCapabilitiesCache && codexCapabilitiesCache.expiresAt > now) {
    return codexCapabilitiesCache.value;
  }

  const modelOutput = runCodexCommand(["debug", "models"]);
  const helpOutput = runCodexCommand(["--help"]) ?? "";
  const capabilities: CodexCliCapabilities = {
    models: modelOutput ? parseCodexModelCapabilities(modelOutput) : [],
    sandboxModes: parseInlinePossibleValues(helpOutput, "--sandbox <SANDBOX_MODE>"),
    approvalPolicies: parseBlockPossibleValues(
      helpOutput,
      "--ask-for-approval <APPROVAL_POLICY>",
    ),
  };

  codexCapabilitiesCache = {
    expiresAt: now + CODEX_CAPABILITIES_CACHE_TTL_MS,
    value: capabilities,
  };

  return capabilities;
}

export function listCodexModels() {
  return getCodexCliCapabilities().models.map((model) => model.slug);
}

export function listCodexReasoningEfforts(model?: string | null) {
  const normalizedModel = model?.trim();
  const capabilities = getCodexCliCapabilities();
  const matchedModel = normalizedModel
    ? capabilities.models.find((entry) => entry.slug === normalizedModel)
    : null;

  if (normalizedModel) {
    if (!matchedModel) {
      return [];
    }

    return uniqValues(
      matchedModel.supported_reasoning_levels.map((entry) => entry.effort),
    );
  }

  return uniqValues(
    capabilities.models.flatMap((entry) =>
      entry.supported_reasoning_levels.map((level) => level.effort)
    ),
  );
}

export function listCodexSandboxModes() {
  return getCodexCliCapabilities().sandboxModes;
}

export function listCodexApprovalPolicies() {
  return getCodexCliCapabilities().approvalPolicies;
}

export function listWorkspaceBranches(workingDirectory?: string) {
  if (!workingDirectory || !isDirectory(workingDirectory)) {
    return [];
  }

  const branches = runGitCommandRaw(workingDirectory, ["branch", "--format", "%(refname:short)"]);
  if (!branches) {
    return [];
  }

  return branches
    .split(/\r?\n/gu)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function buildFallbackRuntime(
  workingDirectory?: string,
  threadId?: string,
): AgentRuntimeInfo | null {
  const defaults = readCodexConfigDefaults();
  const snapshot = captureWorkspaceSnapshot(workingDirectory);

  if (
    !threadId &&
    !workingDirectory &&
    !defaults.model &&
    !defaults.reasoningEffort &&
    !defaults.approvalPolicy &&
    !defaults.sandboxMode &&
    !defaults.modelProvider
  ) {
    return null;
  }

  return {
    ...(threadId ? { thread_id: threadId } : {}),
    model: defaults.model,
    model_provider: defaults.modelProvider,
    reasoning_effort: defaults.reasoningEffort,
    approval_policy: defaults.approvalPolicy,
    sandbox_mode: defaults.sandboxMode,
    branch: snapshot.branch ?? null,
    working_directory: snapshot.workingDirectory ?? null,
    source: "config",
  };
}

function getCodexSessionsRoot() {
  return join(homedir(), ".codex", "sessions");
}

function findCodexSessionLogPath(threadId: string): string | null {
  const root = getCodexSessionsRoot();
  if (!existsSync(root)) {
    return null;
  }

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        entry.name.includes(threadId)
      ) {
        return fullPath;
      }
    }
  }

  return null;
}

function parseJsonlEntries(filePath: string) {
  try {
    const content = readFileSync(filePath, "utf8");
    return content
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as JsonlEntry];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function toTimestampValue(value: string | undefined) {
  if (!value) {
    return Number.NaN;
  }

  return new Date(value).getTime();
}

function readTurnWindow(
  threadId: string,
  turnStartedAt: Date,
  turnCompletedAt: Date,
  workingDirectory?: string,
): TurnWindow | null {
  const logPath = findCodexSessionLogPath(threadId);
  if (!logPath) {
    return null;
  }

  const entries = parseJsonlEntries(logPath);
  if (entries.length === 0) {
    return null;
  }

  const sessionMeta = entries.find((entry) => entry.type === "session_meta");
  const contexts = entries
    .filter((entry) => entry.type === "turn_context")
    .map((entry) => ({
      entry,
      ts: toTimestampValue(entry.timestamp),
    }))
    .filter((item) => Number.isFinite(item.ts))
    .sort((left, right) => left.ts - right.ts);

  const startTs = turnStartedAt.getTime() - 15_000;
  const endTs = turnCompletedAt.getTime() + 60_000;
  let contextIndex = contexts.findLastIndex(
    (item) => item.ts >= startTs && item.ts <= endTs,
  );
  if (contextIndex < 0) {
    contextIndex = contexts.findLastIndex((item) => item.ts <= endTs);
  }
  if (contextIndex < 0) {
    return null;
  }

  const currentContext = contexts[contextIndex];
  if (!currentContext) {
    return null;
  }
  const nextContextTs = contexts[contextIndex + 1]?.ts ?? Number.POSITIVE_INFINITY;
  const windowEntries = entries.filter((entry) => {
    const ts = toTimestampValue(entry.timestamp);
    return Number.isFinite(ts) && ts >= currentContext.ts && ts < nextContextTs;
  });

  const contextPayload = currentContext.entry.payload ?? {};
  const collaborationMode =
    contextPayload.collaboration_mode &&
    typeof contextPayload.collaboration_mode === "object"
      ? (contextPayload.collaboration_mode as Record<string, unknown>)
      : null;
  const collaborationSettings =
    collaborationMode?.settings &&
    typeof collaborationMode.settings === "object"
      ? (collaborationMode.settings as Record<string, unknown>)
      : null;
  const sandboxPolicy =
    contextPayload.sandbox_policy &&
    typeof contextPayload.sandbox_policy === "object"
      ? (contextPayload.sandbox_policy as Record<string, unknown>)
      : null;
  const sessionPayload = sessionMeta?.payload ?? {};
  const runtime: AgentRuntimeInfo = {
    thread_id: threadId,
    model:
      typeof contextPayload.model === "string"
        ? contextPayload.model
        : null,
    model_provider:
      typeof sessionPayload.model_provider === "string"
        ? sessionPayload.model_provider
        : null,
    reasoning_effort:
      typeof collaborationSettings?.reasoning_effort === "string"
        ? collaborationSettings.reasoning_effort
        : typeof contextPayload.effort === "string"
          ? contextPayload.effort
          : null,
    approval_policy:
      typeof contextPayload.approval_policy === "string"
        ? contextPayload.approval_policy
        : null,
    sandbox_mode:
      typeof sandboxPolicy?.type === "string"
        ? sandboxPolicy.type
        : null,
    network_access:
      typeof sandboxPolicy?.network_access === "boolean"
        ? sandboxPolicy.network_access
        : null,
    working_directory:
      typeof contextPayload.cwd === "string"
        ? contextPayload.cwd
        : typeof sessionPayload.cwd === "string"
          ? sessionPayload.cwd
          : workingDirectory ?? null,
    cli_version:
      typeof sessionPayload.cli_version === "string"
        ? sessionPayload.cli_version
        : null,
    source: "turn_context",
  };

  const commands = windowEntries.flatMap((entry) => {
    const payload = entry.payload ?? {};
    if (entry.type !== "event_msg" || payload.type !== "exec_command_end") {
      return [];
    }

    const parsed =
      Array.isArray(payload.parsed_cmd) &&
      payload.parsed_cmd[0] &&
      typeof payload.parsed_cmd[0] === "object"
        ? (payload.parsed_cmd[0] as Record<string, unknown>)
        : null;
    const commandArray = Array.isArray(payload.command)
      ? payload.command.filter((value) => typeof value === "string")
      : [];
    const duration =
      payload.duration && typeof payload.duration === "object"
        ? (payload.duration as Record<string, unknown>)
        : null;

    return [{
      command:
        typeof parsed?.cmd === "string"
          ? parsed.cmd
          : commandArray.length > 0
            ? commandArray.join(" ")
            : "Unknown command",
      cwd: typeof payload.cwd === "string" ? payload.cwd : null,
      output:
        typeof payload.aggregated_output === "string"
          ? truncateText(payload.aggregated_output, COMMAND_OUTPUT_LIMIT)
          : null,
      exit_code:
        typeof payload.exit_code === "number" ? payload.exit_code : null,
      status:
        typeof payload.status === "string" ? payload.status : "completed",
      duration_ms:
        typeof duration?.secs === "number" || typeof duration?.nanos === "number"
          ? Math.round(
              ((typeof duration?.secs === "number" ? duration.secs : 0) * 1000)
                + ((typeof duration?.nanos === "number" ? duration.nanos : 0) / 1_000_000),
            )
          : null,
    } satisfies AgentCommandTrace];
  });

  const files = windowEntries.flatMap((entry) => {
    const payload = entry.payload ?? {};
    if (
      entry.type !== "response_item" ||
      payload.type !== "custom_tool_call" ||
      payload.name !== "apply_patch" ||
      typeof payload.input !== "string"
    ) {
      return [];
    }

    return parseApplyPatchSections(payload.input).map((section) => ({
      path: section.path,
      kind: section.kind,
    }));
  });

  return {
    threadId,
    ...(workingDirectory ? { workingDirectory } : {}),
    runtime,
    commands,
    files,
  };
}

function parseApplyPatchSections(input: string): ParsedPatchSection[] {
  const lines = input.split(/\r?\n/gu);
  const sections: ParsedPatchSection[] = [];
  let current:
    | {
        path: string;
        kind: "add" | "delete" | "update";
        lines: string[];
      }
    | null = null;

  const flush = () => {
    if (!current) {
      return;
    }

    sections.push({
      path: current.path,
      kind: current.kind,
      patch: truncateText(current.lines.join("\n"), DIFF_PATCH_LIMIT),
    });
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("*** Add File: ")) {
      flush();
      current = {
        path: line.slice("*** Add File: ".length).trim().replace(/\\/gu, "/"),
        kind: "add",
        lines: [],
      };
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      flush();
      current = {
        path: line.slice("*** Update File: ".length).trim().replace(/\\/gu, "/"),
        kind: "update",
        lines: [],
      };
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      flush();
      sections.push({
        path: line.slice("*** Delete File: ".length).trim().replace(/\\/gu, "/"),
        kind: "delete",
        patch: "*** File deleted",
      });
      continue;
    }

    if (line === "*** End Patch") {
      flush();
      break;
    }

    if (!current) {
      continue;
    }

    if (
      line.startsWith("@@") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ")
    ) {
      current.lines.push(line);
    }
  }

  flush();
  return sections;
}

function parseDiffKind(lines: string[]) {
  if (lines.some((line) => line.startsWith("new file mode "))) {
    return "add" as const;
  }
  if (lines.some((line) => line.startsWith("deleted file mode "))) {
    return "delete" as const;
  }

  return "update" as const;
}

function parseUnifiedDiffByFile(diffText: string) {
  if (!diffText.trim()) {
    return [];
  }

  const lines = diffText.split(/\r?\n/gu);
  const files: AgentFileDiffTrace[] = [];
  let currentPath = "";
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentPath || currentLines.length === 0) {
      currentPath = "";
      currentLines = [];
      return;
    }

    files.push({
      path: currentPath,
      kind: parseDiffKind(currentLines),
      patch: truncateText(currentLines.join("\n"), DIFF_PATCH_LIMIT),
    });
    currentPath = "";
    currentLines = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      currentLines = [line];
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/u);
      currentPath = match?.[2] ?? "";
      continue;
    }

    if (currentLines.length > 0) {
      currentLines.push(line);

      if (line.startsWith("+++ ")) {
        const nextPath = line.slice(4).trim();
        if (nextPath !== "/dev/null") {
          currentPath = nextPath.replace(/^b\//u, "");
        }
      }
    }
  }

  flush();
  return files;
}

function listUntrackedFiles(cwd: string) {
  const output = runGitCommandRaw(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!output) {
    return [];
  }

  return output
    .split("\0")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function buildAddedFilePatch(filePath: string, content: string) {
  const normalized = content.replace(/\r\n/gu, "\n");
  const lines = normalized.split("\n");
  const patchLines = [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ];

  return truncateText(patchLines.join("\n"), DIFF_PATCH_LIMIT);
}

function readTextFileSafe(filePath: string) {
  try {
    const content = readFileSync(filePath, "utf8");
    return content.replace(/\u0000/gu, "");
  } catch {
    return null;
  }
}

export function captureWorkspaceSnapshot(
  workingDirectory?: string,
): WorkspaceSnapshot {
  if (!workingDirectory || !isDirectory(workingDirectory)) {
    return {
      ...(workingDirectory ? { workingDirectory } : {}),
      branch: null,
      baselineRef: null,
      untrackedBefore: new Set<string>(),
    };
  }

  const gitRoot = runGitCommand(workingDirectory, ["rev-parse", "--show-toplevel"]);
  const branch = runGitCommand(workingDirectory, ["branch", "--show-current"]);
  if (!gitRoot) {
    return {
      ...(workingDirectory ? { workingDirectory } : {}),
      branch,
      baselineRef: null,
      untrackedBefore: new Set<string>(),
    };
  }

  const trackedStatus = runGitCommandRaw(workingDirectory, [
    "status",
    "--porcelain=v1",
    "--untracked-files=no",
  ]);
  const headRef = runGitCommand(workingDirectory, ["rev-parse", "HEAD"]);
  const stashRef =
    trackedStatus && trackedStatus.trim().length > 0
      ? runGitCommand(workingDirectory, ["stash", "create", "syncai-turn-snapshot"])
      : null;

  return {
    workingDirectory,
    gitRoot: resolve(gitRoot),
    branch,
    baselineRef: stashRef || headRef,
    untrackedBefore: new Set(listUntrackedFiles(workingDirectory)),
  };
}

function collectWorkspaceDiff(snapshot: WorkspaceSnapshot): AgentExecutionTrace {
  if (
    !snapshot.workingDirectory ||
    !snapshot.gitRoot ||
    !snapshot.baselineRef
  ) {
    return {
      commands: [],
      files: [],
      file_diffs: [],
    };
  }

  const trackedDiffText = runGitCommandRaw(snapshot.workingDirectory, [
    "diff",
    "--no-ext-diff",
    "--find-renames",
    "--unified=3",
    snapshot.baselineRef,
    "--",
  ]) ?? "";
  const trackedDiffs = parseUnifiedDiffByFile(trackedDiffText);
  const files = new Map<string, AgentFileTrace>();
  for (const diff of trackedDiffs) {
    files.set(diff.path, { path: diff.path, kind: diff.kind });
  }

  const untrackedAfter = new Set(listUntrackedFiles(snapshot.workingDirectory));
  for (const filePath of untrackedAfter) {
    if (snapshot.untrackedBefore.has(filePath)) {
      continue;
    }

    const absolutePath = join(snapshot.workingDirectory, filePath);
    const content = readTextFileSafe(absolutePath);
    if (content === null) {
      continue;
    }

    trackedDiffs.push({
      path: filePath.replace(/\\/gu, "/"),
      kind: "add",
      patch: buildAddedFilePatch(filePath.replace(/\\/gu, "/"), content),
    });
    files.set(filePath.replace(/\\/gu, "/"), {
      path: filePath.replace(/\\/gu, "/"),
      kind: "add",
    });
  }

  return {
    commands: [],
    files: [...files.values()],
    file_diffs: trackedDiffs,
  };
}

function mergeFileLists(
  primary: AgentFileTrace[],
  fallback: AgentFileTrace[],
): AgentFileTrace[] {
  const merged = new Map<string, AgentFileTrace>();
  for (const item of [...primary, ...fallback]) {
    if (!item.path) {
      continue;
    }
    merged.set(item.path, item);
  }
  return [...merged.values()];
}

function normalizeFileList(
  files: AgentFileTrace[],
  workingDirectory?: string,
) {
  if (!workingDirectory) {
    return files;
  }

  return files.map((file) => ({
    ...file,
    path: toWorkspaceRelativePath(workingDirectory, file.path),
  }));
}

function normalizeDiffPaths(
  diffs: AgentFileDiffTrace[],
  workingDirectory?: string,
) {
  if (!workingDirectory) {
    return diffs;
  }

  return diffs.map((diff) => ({
    ...diff,
    path: toWorkspaceRelativePath(workingDirectory, diff.path),
  }));
}

export function buildAgentMessageMetadata(input: {
  threadId?: string;
  workingDirectory?: string;
  turnStartedAt: Date;
  turnCompletedAt: Date;
  snapshot: WorkspaceSnapshot;
  fallbackCommands: AgentCommandTrace[];
  fallbackFiles: AgentFileTrace[];
  usage?: AgentUsageTrace;
}): AgentMessageMetadataShape {
  const turnWindow = input.threadId
    ? readTurnWindow(
        input.threadId,
        input.turnStartedAt,
        input.turnCompletedAt,
        input.workingDirectory,
      )
    : null;
  const runtime =
    turnWindow?.runtime
      ? {
          ...turnWindow.runtime,
          branch: input.snapshot.branch ?? turnWindow.runtime.branch ?? null,
          working_directory:
            input.workingDirectory
            ?? turnWindow.runtime.working_directory
            ?? null,
        }
      : buildFallbackRuntime(input.workingDirectory, input.threadId);
  const workspaceDiff = collectWorkspaceDiff(input.snapshot);
  const commands = turnWindow?.commands?.length
    ? turnWindow.commands
    : input.fallbackCommands;
  const fileDiffs = normalizeDiffPaths(
    workspaceDiff.file_diffs,
    input.workingDirectory,
  );
  const files = normalizeFileList(
    mergeFileLists(
      workspaceDiff.files,
      turnWindow?.files?.length
        ? turnWindow.files
        : input.fallbackFiles,
    ),
    input.workingDirectory,
  );

  return {
    ...(runtime ? { codex_runtime: runtime } : {}),
    execution_trace: {
      commands,
      files,
      file_diffs: fileDiffs,
    },
    ...(input.usage ? { usage: input.usage } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractAgentRuntimeFromMetadata(
  metadata: unknown,
): AgentRuntimeInfo | null {
  if (!isRecord(metadata) || !isRecord(metadata.codex_runtime)) {
    return null;
  }

  const runtime = metadata.codex_runtime;
  return {
    ...(typeof runtime.thread_id === "string"
      ? { thread_id: runtime.thread_id }
      : {}),
    model: typeof runtime.model === "string" ? runtime.model : null,
    model_provider:
      typeof runtime.model_provider === "string"
        ? runtime.model_provider
        : null,
    reasoning_effort:
      typeof runtime.reasoning_effort === "string"
        ? runtime.reasoning_effort
        : null,
    approval_policy:
      typeof runtime.approval_policy === "string"
        ? runtime.approval_policy
        : null,
    sandbox_mode:
      typeof runtime.sandbox_mode === "string"
        ? runtime.sandbox_mode
        : null,
    network_access:
      typeof runtime.network_access === "boolean"
        ? runtime.network_access
        : null,
    branch: typeof runtime.branch === "string" ? runtime.branch : null,
    working_directory:
      typeof runtime.working_directory === "string"
        ? runtime.working_directory
        : null,
    cli_version:
      typeof runtime.cli_version === "string" ? runtime.cli_version : null,
    source: typeof runtime.source === "string" ? runtime.source : null,
  };
}

export function buildSessionAgentRuntime(input: {
  threadId?: string;
  workingDirectory?: string;
  latestMetadata?: unknown;
}): AgentRuntimeInfo | null {
  const latestRuntime = extractAgentRuntimeFromMetadata(input.latestMetadata);
  if (latestRuntime) {
    const snapshot = captureWorkspaceSnapshot(
      input.workingDirectory ?? latestRuntime.working_directory ?? undefined,
    );
    return {
      ...latestRuntime,
      branch: snapshot.branch ?? latestRuntime.branch ?? null,
      working_directory:
        input.workingDirectory
        ?? latestRuntime.working_directory
        ?? null,
    };
  }

  return buildFallbackRuntime(input.workingDirectory, input.threadId);
}
