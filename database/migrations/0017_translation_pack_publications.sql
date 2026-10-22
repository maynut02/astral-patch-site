-- Runtime translation packs published to R2 for the Korean plugin.
-- Numbers come from a sequence so a failed publish can never hand out a number that a
-- pointer may already reference; gaps are expected. The plugin only compares numbers.
CREATE SEQUENCE translation_pack_number_seq AS integer START 1;

CREATE TABLE translation_pack_publications (
    number integer PRIMARY KEY CHECK (number > 0),
    game_version text NOT NULL CHECK (btrim(game_version) <> ''),
    revision text NOT NULL CHECK (btrim(revision) <> ''),
    object_key text NOT NULL UNIQUE CHECK (btrim(object_key) <> ''),
    byte_size integer NOT NULL CHECK (byte_size > 0),
    gzip_byte_size integer NOT NULL CHECK (gzip_byte_size > 0),
    gzip_sha256 text NOT NULL CHECK (gzip_sha256 ~ '^[0-9a-f]{64}$'),
    lang_count integer NOT NULL CHECK (lang_count >= 0),
    str_count integer NOT NULL CHECK (str_count >= 0),
    published_by text NOT NULL REFERENCES app_users(google_sub) ON DELETE RESTRICT,
    published_at timestamptz NOT NULL DEFAULT now(),
    -- Set once the pack object is removed from R2 by retention cleanup.
    object_deleted_at timestamptz
);

ALTER SEQUENCE translation_pack_number_seq OWNED BY translation_pack_publications.number;

CREATE INDEX translation_pack_publications_retained_idx
    ON translation_pack_publications (game_version, revision, number DESC)
    WHERE object_deleted_at IS NULL;
