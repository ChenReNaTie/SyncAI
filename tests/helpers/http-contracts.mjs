import assert from "node:assert/strict";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function assertExpectedFields(actual, expected = {}) {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value);
  }
}

export function assertStrictKeys(actual, expectedKeys) {
  assert.deepEqual(
    Object.keys(actual).sort(),
    [...expectedKeys].sort(),
  );
}

export function assertUuid(value) {
  assert.equal(typeof value, "string");
  assert.match(value, uuidPattern);
}

export function assertIsoTimestamp(value) {
  assert.equal(typeof value, "string");
  assert.ok(!Number.isNaN(Date.parse(value)));
}

export function assertNullableIsoTimestamp(value) {
  assert.ok(value === null || typeof value === "string");
  if (value !== null) {
    assertIsoTimestamp(value);
  }
}

export function assertAuthRequiredError(payload) {
  assertStrictKeys(payload, ["code"]);
  assert.equal(payload.code, "AUTH_REQUIRED");
}

export function assertUserContract(user, expected = {}) {
  assertStrictKeys(user, ["display_name", "email", "id"]);
  assertUuid(user.id);
  assert.equal(typeof user.email, "string");
  assert.equal(typeof user.display_name, "string");
  assertExpectedFields(user, expected);
}

export function assertTeamContract(team, expected = {}) {
  assertStrictKeys(team, [
    "created_at",
    "created_by",
    "default_agent_type",
    "id",
    "member_role",
    "name",
    "slug",
    "updated_at",
  ]);
  assertUuid(team.id);
  assertUuid(team.created_by);
  assert.equal(typeof team.name, "string");
  assert.equal(typeof team.slug, "string");
  assert.equal(team.default_agent_type, "codex");
  assert.ok(["admin", "member"].includes(team.member_role));
  assertIsoTimestamp(team.created_at);
  assertIsoTimestamp(team.updated_at);
  assertExpectedFields(team, expected);
}

export function assertTeamMemberContract(member, expected = {}) {
  assertStrictKeys(member, [
    "invited_by",
    "joined_at",
    "role",
    "team_id",
    "user_id",
  ]);
  assertUuid(member.team_id);
  assertUuid(member.user_id);
  assert.ok(member.invited_by === null || typeof member.invited_by === "string");
  if (member.invited_by !== null) {
    assertUuid(member.invited_by);
  }
  assert.ok(["admin", "member"].includes(member.role));
  assertIsoTimestamp(member.joined_at);
  assertExpectedFields(member, expected);
}

export function assertProjectContract(project, expected = {}) {
  assertStrictKeys(project, [
    "archived_at",
    "created_at",
    "created_by",
    "description",
    "id",
    "name",
    "team_id",
    "updated_at",
  ]);
  assertUuid(project.id);
  assertUuid(project.team_id);
  assertUuid(project.created_by);
  assert.equal(typeof project.name, "string");
  assert.ok(project.description === null || typeof project.description === "string");
  assertNullableIsoTimestamp(project.archived_at);
  assertIsoTimestamp(project.created_at);
  assertIsoTimestamp(project.updated_at);
  assertExpectedFields(project, expected);
}

export function assertAgentNodeContract(node, expected = {}) {
  assertStrictKeys(node, [
    "agent_type",
    "client_fingerprint",
    "connection_status",
    "created_at",
    "display_name",
    "id",
    "last_heartbeat_at",
    "metadata",
    "node_mode",
    "owner_user_id",
    "team_id",
    "updated_at",
  ]);
  assertUuid(node.id);
  assertUuid(node.team_id);
  assertUuid(node.owner_user_id);
  assert.equal(node.agent_type, "codex");
  assert.equal(node.node_mode, "admin_local");
  assert.equal(typeof node.display_name, "string");
  assert.ok(["offline", "connecting", "online", "error"].includes(node.connection_status));
  assert.ok(
    node.client_fingerprint === null ||
      typeof node.client_fingerprint === "string",
  );
  assertNullableIsoTimestamp(node.last_heartbeat_at);
  assert.equal(typeof node.metadata, "object");
  assert.ok(node.metadata !== null);
  assertIsoTimestamp(node.created_at);
  assertIsoTimestamp(node.updated_at);
  assertExpectedFields(node, expected);
}

export function assertSessionNotVisibleError(payload) {
  assertStrictKeys(payload, ["code"]);
  assert.equal(payload.code, "SESSION_NOT_VISIBLE");
}

export function assertInvalidCursorError(payload) {
  assertStrictKeys(payload, ["code", "details"]);
  assert.equal(payload.code, "INVALID_REQUEST");
  assertStrictKeys(payload.details, ["fieldErrors", "formErrors"]);
  assert.deepEqual(payload.details.formErrors, []);
  assert.deepEqual(payload.details.fieldErrors.cursor, ["Invalid cursor"]);
}

export function assertCursorEnvelope(payload, expectedLength) {
  assertStrictKeys(payload, ["data", "meta"]);
  assert.ok(Array.isArray(payload.data));
  assert.equal(payload.data.length, expectedLength);
  assertStrictKeys(payload.meta, ["next_cursor"]);

  if (payload.meta.next_cursor !== null) {
    assert.equal(typeof payload.meta.next_cursor, "string");
    assert.ok(payload.meta.next_cursor.length > 0);
  }
}

export function assertSessionContract(session, expected = {}) {
  assertStrictKeys(session, [
    "id",
    "project_id",
    "creator_id",
    "title",
    "visibility",
    "runtime_status",
    "bound_agent_type",
    "bound_agent_node_id",
    "bound_agent_session_ref",
    "last_message_at",
    "created_at",
    "updated_at",
    "pending_count",
  ]);
  assertUuid(session.id);
  assertUuid(session.project_id);
  assertUuid(session.creator_id);
  assert.equal(typeof session.title, "string");
  assert.ok(["shared", "private"].includes(session.visibility));
  assert.ok(
    ["idle", "queued", "running", "completed", "error"].includes(
      session.runtime_status,
    ),
  );
  assert.equal(session.bound_agent_type, "codex");
  assertUuid(session.bound_agent_node_id);
  assert.equal(typeof session.bound_agent_session_ref, "string");
  assert.ok(session.bound_agent_session_ref.length > 0);
  assertNullableIsoTimestamp(session.last_message_at);
  assertIsoTimestamp(session.created_at);
  assertIsoTimestamp(session.updated_at);
  assert.equal(typeof session.pending_count, "number");
  assert.ok(Number.isInteger(session.pending_count));
  assertExpectedFields(session, expected);
}

export function assertMessageContract(message, expected = {}) {
  assertStrictKeys(message, [
    "id",
    "session_id",
    "sender_type",
    "sender_user_id",
    "content",
    "processing_status",
    "is_final_reply",
    "client_message_id",
    "error_summary",
    "metadata",
    "created_at",
  ]);
  assertUuid(message.id);
  assertUuid(message.session_id);
  assert.ok(["member", "agent"].includes(message.sender_type));
  assert.ok(message.sender_user_id === null || typeof message.sender_user_id === "string");
  if (message.sender_user_id !== null) {
    assertUuid(message.sender_user_id);
  }
  assert.equal(typeof message.content, "string");
  assert.ok(
    ["accepted", "queued", "running", "completed", "failed"].includes(
      message.processing_status,
    ),
  );
  assert.equal(typeof message.is_final_reply, "boolean");
  assert.ok(
    message.client_message_id === null ||
      typeof message.client_message_id === "string",
  );
  assert.ok(
    message.error_summary === null || typeof message.error_summary === "string",
  );
  assert.equal(typeof message.metadata, "object");
  assert.ok(message.metadata !== null);
  assertIsoTimestamp(message.created_at);
  assertExpectedFields(message, expected);
}

export function assertSearchResultContract(result, expected = {}) {
  assertStrictKeys(result, [
    "session_id",
    "project_id",
    "message_id",
    "sender_type",
    "snippet",
    "occurred_at",
  ]);
  assertUuid(result.session_id);
  assertUuid(result.project_id);
  assertUuid(result.message_id);
  assert.ok(["member", "agent"].includes(result.sender_type));
  assert.equal(typeof result.snippet, "string");
  assertIsoTimestamp(result.occurred_at);
  assertExpectedFields(result, expected);
}

export function assertTodoContract(todo, expected = {}) {
  assertStrictKeys(todo, [
    "id",
    "session_id",
    "source_message_id",
    "title",
    "status",
    "creator_id",
    "created_at",
    "updated_at",
  ]);
  assertUuid(todo.id);
  assertUuid(todo.session_id);
  assertUuid(todo.source_message_id);
  assert.equal(typeof todo.title, "string");
  assert.ok(["pending", "completed"].includes(todo.status));
  assertUuid(todo.creator_id);
  assertIsoTimestamp(todo.created_at);
  assertIsoTimestamp(todo.updated_at);
  assertExpectedFields(todo, expected);
}

export function assertAuditLogContract(log, expected = {}) {
  assertStrictKeys(log, [
    "id",
    "session_id",
    "action_type",
    "previous_visibility",
    "new_visibility",
    "visible_scope_snapshot",
    "shared_started_at",
    "shared_ended_at",
    "operator_id",
    "created_at",
  ]);
  assertUuid(log.id);
  assertUuid(log.session_id);
  assert.equal(typeof log.action_type, "string");
  assert.ok(["shared", "private"].includes(log.previous_visibility));
  assert.ok(["shared", "private"].includes(log.new_visibility));
  assert.ok(Array.isArray(log.visible_scope_snapshot));
  for (const member of log.visible_scope_snapshot) {
    assertStrictKeys(member, ["role", "user_id"]);
    assertUuid(member.user_id);
    assert.equal(typeof member.role, "string");
  }
  assertNullableIsoTimestamp(log.shared_started_at);
  assertNullableIsoTimestamp(log.shared_ended_at);
  assertUuid(log.operator_id);
  assertIsoTimestamp(log.created_at);
  assertExpectedFields(log, expected);
}

export function assertReplayMessageEntry(entry, expected = {}) {
  assertStrictKeys(entry, [
    "entry_type",
    "message_id",
    "occurred_at",
    "sender_type",
    "content",
  ]);
  assert.equal(entry.entry_type, "message");
  assertUuid(entry.message_id);
  assertIsoTimestamp(entry.occurred_at);
  assert.ok(["member", "agent"].includes(entry.sender_type));
  assert.equal(typeof entry.content, "string");
  assertExpectedFields(entry, expected);
}

export function assertReplayStatusChangedEntry(entry, expected = {}) {
  assertStrictKeys(entry, [
    "entry_type",
    "occurred_at",
    "from",
    "to",
    "summary",
  ]);
  assert.equal(entry.entry_type, "status_changed");
  assertIsoTimestamp(entry.occurred_at);
  assert.ok(entry.from === null || typeof entry.from === "string");
  assert.ok(entry.to === null || typeof entry.to === "string");
  assert.equal(typeof entry.summary, "string");
  assertExpectedFields(entry, expected);
}

export function assertReplayCommandSummaryEntry(entry, expected = {}) {
  assertStrictKeys(entry, ["entry_type", "occurred_at", "summary"]);
  assert.equal(entry.entry_type, "command_summary");
  assertIsoTimestamp(entry.occurred_at);
  assert.equal(typeof entry.summary, "string");
  assertExpectedFields(entry, expected);
}

export function assertReplayVisibilityChangedEntry(entry, expected = {}) {
  assertStrictKeys(entry, [
    "entry_type",
    "occurred_at",
    "from",
    "to",
    "summary",
  ]);
  assert.equal(entry.entry_type, "visibility_changed");
  assertIsoTimestamp(entry.occurred_at);
  assert.ok(entry.from === null || typeof entry.from === "string");
  assert.ok(entry.to === null || typeof entry.to === "string");
  assert.equal(typeof entry.summary, "string");
  assertExpectedFields(entry, expected);
}
