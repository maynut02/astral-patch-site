ALTER TABLE translation_changes
ADD COLUMN change_kind text NOT NULL DEFAULT 'translation_edit'
CHECK (change_kind IN ('translation_edit', 'retain_confirmation'));

UPDATE translation_changes AS changes
SET change_kind = 'retain_confirmation'
FROM translation_change_groups AS groups
WHERE groups.id = changes.group_id
  AND groups.title = '현재 번역 유지 확인'
  AND changes.previous_text IS NOT DISTINCT FROM changes.proposed_text;

ALTER TABLE translation_changes
ALTER COLUMN change_kind DROP DEFAULT;

CREATE INDEX translation_changes_review_kind_idx
ON translation_changes (locale, status, change_kind, created_at DESC, id DESC);
