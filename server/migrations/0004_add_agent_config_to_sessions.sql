ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS agent_config jsonb NOT NULL DEFAULT '{}'::jsonb;
