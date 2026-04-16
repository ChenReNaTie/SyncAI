CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE team_member_role AS ENUM ('admin', 'member');
CREATE TYPE agent_type AS ENUM ('codex');
CREATE TYPE node_mode AS ENUM ('admin_local');
CREATE TYPE connection_status AS ENUM ('offline', 'connecting', 'online', 'error');
CREATE TYPE session_visibility AS ENUM ('shared', 'private');
CREATE TYPE session_runtime_status AS ENUM ('idle', 'queued', 'running', 'completed', 'error');
CREATE TYPE sender_type AS ENUM ('member', 'agent');
CREATE TYPE message_processing_status AS ENUM ('accepted', 'queued', 'running', 'completed', 'failed');
CREATE TYPE session_event_type AS ENUM (
  'status.changed',
  'command.summary',
  'message.queued',
  'session.shared',
  'session.privatized',
  'message.failed',
  'node.status_changed'
);
CREATE TYPE todo_status AS ENUM ('pending', 'completed');
CREATE TYPE session_audit_action AS ENUM ('visibility.changed');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  display_name varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE INDEX idx_users_created_at ON users (created_at DESC);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  slug varchar(100) NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  default_agent_type agent_type NOT NULL DEFAULT 'codex',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role team_member_role NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  invited_by uuid REFERENCES users(id),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX idx_team_members_user_id ON team_members (user_id);

CREATE TABLE team_agent_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  agent_type agent_type NOT NULL DEFAULT 'codex',
  node_mode node_mode NOT NULL DEFAULT 'admin_local',
  display_name varchar(100) NOT NULL,
  connection_status connection_status NOT NULL DEFAULT 'offline',
  last_heartbeat_at timestamptz,
  client_fingerprint varchar(255),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_team_agent_nodes_team_agent UNIQUE (team_id, agent_type)
);

CREATE INDEX idx_team_agent_nodes_owner_user_id ON team_agent_nodes (owner_user_id);
CREATE INDEX idx_team_agent_nodes_connection_status ON team_agent_nodes (connection_status);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  description text,
  created_by uuid NOT NULL REFERENCES users(id),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_team_id ON projects (team_id);
CREATE INDEX idx_projects_archived_at ON projects (archived_at);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES users(id),
  title varchar(200) NOT NULL,
  visibility session_visibility NOT NULL,
  runtime_status session_runtime_status NOT NULL DEFAULT 'idle',
  bound_agent_type agent_type NOT NULL DEFAULT 'codex',
  bound_agent_node_id uuid NOT NULL REFERENCES team_agent_nodes(id),
  bound_agent_session_ref varchar(255) NOT NULL,
  last_message_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_project_id ON sessions (project_id);
CREATE INDEX idx_sessions_creator_id ON sessions (creator_id);
CREATE INDEX idx_sessions_visibility_runtime ON sessions (visibility, runtime_status);
CREATE INDEX idx_sessions_last_message_at ON sessions (last_message_at DESC NULLS LAST);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender_type sender_type NOT NULL,
  sender_user_id uuid REFERENCES users(id),
  content text NOT NULL,
  content_format varchar(20) NOT NULL DEFAULT 'markdown',
  processing_status message_processing_status NOT NULL,
  is_final_reply boolean NOT NULL DEFAULT false,
  sequence_no bigint NOT NULL,
  client_message_id varchar(100),
  error_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    CASE
      WHEN sender_type = 'member'
        OR (sender_type = 'agent' AND is_final_reply = TRUE)
      THEN to_tsvector('simple', coalesce(content, ''))
      ELSE NULL
    END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_messages_session_sequence UNIQUE (session_id, sequence_no),
  CONSTRAINT uq_messages_session_client_message UNIQUE NULLS NOT DISTINCT (session_id, client_message_id),
  CONSTRAINT chk_messages_member_sender
    CHECK (
      (sender_type = 'member' AND sender_user_id IS NOT NULL)
      OR (sender_type = 'agent' AND sender_user_id IS NULL)
    )
);

CREATE INDEX idx_messages_session_id_created_at ON messages (session_id, created_at);
CREATE INDEX idx_messages_processing_status ON messages (processing_status);
CREATE INDEX idx_messages_search ON messages USING GIN (search_vector);

CREATE TABLE session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  related_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  event_type session_event_type NOT NULL,
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_events_session_occurred_at ON session_events (session_id, occurred_at);
CREATE INDEX idx_session_events_type ON session_events (event_type);

CREATE TABLE todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  title varchar(255) NOT NULL,
  status todo_status NOT NULL DEFAULT 'pending',
  creator_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_todos_session_id ON todos (session_id);
CREATE INDEX idx_todos_source_message_id ON todos (source_message_id);
CREATE INDEX idx_todos_status ON todos (status);

CREATE TABLE session_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  action_type session_audit_action NOT NULL,
  previous_visibility session_visibility NOT NULL,
  new_visibility session_visibility NOT NULL,
  visible_scope_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  shared_started_at timestamptz,
  shared_ended_at timestamptz,
  operator_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_audit_logs_session_id ON session_audit_logs (session_id, created_at DESC);
