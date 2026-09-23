CREATE TABLE party_chat_sessions (
    id uuid PRIMARY KEY,
    room_id text NOT NULL UNIQUE CHECK (room_id ~ '^[0-9]{6}$'),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE INDEX party_chat_sessions_expires_idx ON party_chat_sessions (expires_at);

CREATE TABLE party_chat_participants (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES party_chat_sessions(id) ON DELETE CASCADE,
    nickname text NOT NULL,
    character_id text NOT NULL,
    party_order text,
    CHECK ((character_id = 'spectator' AND party_order IS NULL)
        OR (character_id <> 'spectator' AND party_order IN ('P1', 'P2', 'P3', 'P4')))
);

CREATE TABLE party_chat_messages (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id uuid NOT NULL UNIQUE,
    session_id uuid NOT NULL REFERENCES party_chat_sessions(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('chat', 'join', 'leave')),
    participant_id uuid REFERENCES party_chat_participants(id) ON DELETE CASCADE,
    nickname text,
    client_message_id text,
    body text,
    created_at timestamptz NOT NULL,
    CHECK ((kind = 'chat' AND participant_id IS NOT NULL AND client_message_id IS NOT NULL
        AND body IS NOT NULL AND nickname IS NULL)
        OR (kind IN ('join', 'leave') AND participant_id IS NULL AND client_message_id IS NULL
        AND body IS NULL AND nickname IS NOT NULL))
);

CREATE INDEX party_chat_messages_session_sequence_idx
    ON party_chat_messages (session_id, sequence DESC);
