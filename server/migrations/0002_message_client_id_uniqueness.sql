ALTER TABLE messages
DROP CONSTRAINT IF EXISTS uq_messages_session_client_message;

CREATE UNIQUE INDEX uq_messages_session_client_message
ON messages (session_id, client_message_id)
WHERE client_message_id IS NOT NULL;
