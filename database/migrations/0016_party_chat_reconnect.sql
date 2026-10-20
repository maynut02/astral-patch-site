ALTER TABLE party_chat_participants
    ADD COLUMN reconnect_token_hash text,
    ADD COLUMN departure_deadline timestamptz,
    ADD COLUMN left_at timestamptz;

DELETE FROM party_chat_messages duplicate
USING party_chat_messages original
WHERE duplicate.kind = 'chat' AND original.kind = 'chat'
    AND duplicate.participant_id = original.participant_id
    AND duplicate.client_message_id = original.client_message_id
    AND duplicate.sequence > original.sequence;

CREATE UNIQUE INDEX party_chat_messages_participant_client_idx
    ON party_chat_messages (participant_id, client_message_id) WHERE kind = 'chat';

-- Deliberately independent of sessions/participants: diagnostics survive room deletion.
CREATE TABLE party_chat_connection_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    event text NOT NULL,
    room_id text,
    session_id uuid,
    participant_id uuid,
    nickname text,
    connection_id text,
    close_code int,
    close_reason text,
    departure text,
    connected_ms int,
    detail jsonb
);

CREATE INDEX party_chat_connection_events_created_idx ON party_chat_connection_events (created_at);
CREATE INDEX party_chat_connection_events_room_created_idx ON party_chat_connection_events (room_id, created_at);
CREATE INDEX party_chat_connection_events_participant_created_idx ON party_chat_connection_events (participant_id, created_at);
