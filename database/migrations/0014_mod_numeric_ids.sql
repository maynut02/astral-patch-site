LOCK TABLE mods IN ACCESS EXCLUSIVE MODE;

ALTER TABLE mods ADD COLUMN numeric_id bigint;

WITH numbered AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS numeric_id
    FROM mods
)
UPDATE mods
SET numeric_id = numbered.numeric_id
FROM numbered
WHERE mods.id = numbered.id;

ALTER TABLE mods DROP CONSTRAINT mods_pkey;
DROP INDEX mods_updated_idx;
ALTER TABLE mods DROP COLUMN id;
ALTER TABLE mods RENAME COLUMN numeric_id TO id;
ALTER TABLE mods ALTER COLUMN id SET NOT NULL;
ALTER TABLE mods ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
ALTER TABLE mods ADD PRIMARY KEY (id);
ALTER TABLE mods ADD CONSTRAINT mods_id_positive CHECK (id > 0);

-- The next insert starts at 1 for an empty table, or after existing IDs.
SELECT setval(pg_get_serial_sequence('mods', 'id'), COALESCE(max(id), 0) + 1, false)
FROM mods;

CREATE INDEX mods_updated_idx ON mods (updated_at DESC, id DESC);
