CREATE TABLE mods (
    id uuid PRIMARY KEY,
    name text NOT NULL
        CHECK (btrim(name) <> '' AND char_length(name) <= 120),
    summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 300),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
    repository text NOT NULL
        CHECK (repository ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}$'),
    platforms text[] NOT NULL
        CHECK (array_ndims(platforms) = 1
            AND cardinality(platforms) BETWEEN 1 AND 2
            AND platforms <@ ARRAY['windows', 'android']::text[]
            AND array_position(platforms, NULL) IS NULL),
    created_by text NOT NULL REFERENCES app_users(google_sub) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mods_repository_unique_idx ON mods (lower(repository));
CREATE INDEX mods_updated_idx ON mods (updated_at DESC, id DESC);
CREATE INDEX mods_created_by_idx ON mods (created_by);
