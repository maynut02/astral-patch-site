import type { DatabaseClient } from './database'

let editorIndexesReady: Promise<void> | undefined

/**
 * Idempotent indexes for the editor read paths. These tables are owned by the
 * data pipeline, so keep this migration limited to indexes on columns already
 * required by the editor queries.
 */
export async function ensureEditorIndexes(database: DatabaseClient): Promise<void> {
  if (!editorIndexesReady) {
    editorIndexesReady = (async () => {
      await database`
        CREATE INDEX IF NOT EXISTS translation_changes_latest_unit_idx
        ON translation_changes (unit_id, locale, created_at DESC, id DESC)
      `
      await database`
        CREATE INDEX IF NOT EXISTS translation_changes_log_idx
        ON translation_changes (locale, status, created_at DESC, id DESC)
      `
      await database`
        CREATE INDEX IF NOT EXISTS source_changes_unit_revision_idx
        ON source_changes (unit_id, revision_id, change_type)
      `
      await database`
        CREATE INDEX IF NOT EXISTS source_changes_revision_unit_idx
        ON source_changes (revision_id, unit_id, created_at DESC)
      `
      await database`
        CREATE INDEX IF NOT EXISTS translation_units_namespace_key_idx
        ON translation_units (namespace, unit_key, id)
      `
    })().catch((error) => {
      editorIndexesReady = undefined
      throw error
    })
  }

  await editorIndexesReady
}
