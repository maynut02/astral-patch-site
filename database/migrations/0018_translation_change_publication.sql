-- Existing history remains unlinked until the first successful publication after migration.
ALTER TABLE translation_changes
ADD COLUMN pack_number integer REFERENCES translation_pack_publications(number) ON DELETE RESTRICT,
ADD CONSTRAINT translation_changes_pack_approved_check
    CHECK (pack_number IS NULL OR status = 'approved');

-- Each publish claims every approved Korean history row visible in its pack snapshot,
-- including approvals that have since been replaced by another approved translation.
CREATE INDEX translation_changes_unpublished_ko_idx
    ON translation_changes (id)
    WHERE locale = 'ko' AND status = 'approved' AND pack_number IS NULL;
