ALTER TABLE editor_dictionaries ADD COLUMN is_team boolean NOT NULL DEFAULT false;
ALTER TABLE editor_dictionaries ADD CONSTRAINT editor_team_dictionary_public CHECK (NOT is_team OR visibility = 'public');
ALTER TABLE editor_dictionary_entries ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE editor_dictionary_entries ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE TABLE editor_dictionary_proposals (
    id uuid PRIMARY KEY,
    dictionary_id uuid NOT NULL REFERENCES editor_dictionaries(id) ON DELETE CASCADE,
    entry_id uuid REFERENCES editor_dictionary_entries(id) ON DELETE RESTRICT,
    result_entry_id uuid REFERENCES editor_dictionary_entries(id) ON DELETE RESTRICT,
    base_revision integer NOT NULL DEFAULT 0 CHECK (base_revision >= 0),
    source_text text NOT NULL CHECK (btrim(source_text) <> ''),
    translation text NOT NULL CHECK (btrim(translation) <> ''),
    note text NOT NULL DEFAULT '',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    change_kind text NOT NULL CHECK (change_kind IN ('new', 'terminology', 'meaning', 'style')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'held', 'approved', 'rejected', 'withdrawn')),
    created_by text NOT NULL REFERENCES app_users(google_sub) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    history jsonb NOT NULL DEFAULT '[]'::jsonb,
    CHECK (jsonb_typeof(metadata) = 'object' AND jsonb_typeof(history) = 'array'),
    CHECK ((entry_id IS NULL AND base_revision = 0) OR (entry_id IS NOT NULL AND base_revision > 0)),
    UNIQUE (created_by, request_id)
);

CREATE INDEX editor_dictionary_proposals_list_idx ON editor_dictionary_proposals (dictionary_id, status, created_at DESC, id);
CREATE INDEX editor_dictionary_proposals_entry_idx ON editor_dictionary_proposals (entry_id, created_at DESC);
