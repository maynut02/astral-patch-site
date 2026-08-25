import { ensureBotWorkMigration } from './auth-user'
import { getDatabase } from './database'
import type {
  EditorCategoryProgress,
  EditorOverviewResponse,
  EditorProgressCounts,
  EditorProgressSummary,
  EditorVersionProgress
} from '../../shared/types/editor-overview'

interface EditorProgressCountRow {
  total: number
  success: number
  info: number
  warning: number
  untranslated: number
}

interface EditorOverviewRow extends EditorProgressCountRow {
  category: string
}

interface EditorVersionOverviewRow extends EditorProgressCountRow {
  id: string
  version: string
  revision: string
}

function emptyCounts(): EditorProgressCounts {
  return {
    success: 0,
    info: 0,
    warning: 0,
    untranslated: 0
  }
}

function toCounts(row: EditorProgressCountRow): EditorProgressCounts {
  return {
    success: Number(row.success || 0),
    info: Number(row.info || 0),
    warning: Number(row.warning || 0),
    untranslated: Number(row.untranslated || 0)
  }
}

function toSummary(total: number, counts: EditorProgressCounts): EditorProgressSummary {
  return {
    total,
    ...counts
  }
}

export async function getEditorOverview(): Promise<EditorOverviewResponse> {
  const database = getDatabase()
  await ensureBotWorkMigration(database)

  const [rows, versionRows] = await Promise.all([
    database<EditorOverviewRow[]>`
    WITH workbench AS (
      SELECT
        wb.namespace AS category,
        wb.latest_change_status AS latest_change_status,
        wb.approved_for_current_source AS approved_for_current_source,
        CASE
          WHEN wb.latest_change_status = 'pending'
            THEN COALESCE(
              NULLIF(BTRIM(wb.latest_proposed_text), ''),
              NULLIF(BTRIM(wb.approved_text), '')
            )
          ELSE NULLIF(BTRIM(wb.approved_text), '')
        END AS effective_text
      FROM translation_workbench wb
      WHERE NULLIF(BTRIM(wb.namespace), '') IS NOT NULL
    )
    SELECT
      category,
      count(*)::int AS total,
      count(*) FILTER (
        WHERE effective_text IS NOT NULL
          AND latest_change_status IS DISTINCT FROM 'pending'
          AND approved_for_current_source IS TRUE
      )::int AS success,
      count(*) FILTER (
        WHERE effective_text IS NOT NULL
          AND latest_change_status = 'pending'
      )::int AS info,
      count(*) FILTER (
        WHERE effective_text IS NOT NULL
          AND latest_change_status IS DISTINCT FROM 'pending'
          AND approved_for_current_source IS NOT TRUE
      )::int AS warning,
      count(*) FILTER (WHERE effective_text IS NULL)::int AS untranslated
    FROM workbench
    GROUP BY category
    ORDER BY category ASC
    `,
    database<EditorVersionOverviewRow[]>`
      WITH workbench AS (
        SELECT
          wb.unit_id,
          wb.latest_change_status AS latest_change_status,
          wb.approved_for_current_source AS approved_for_current_source,
          CASE
            WHEN wb.latest_change_status = 'pending'
              THEN COALESCE(
                NULLIF(BTRIM(wb.latest_proposed_text), ''),
                NULLIF(BTRIM(wb.approved_text), '')
              )
            ELSE NULLIF(BTRIM(wb.approved_text), '')
          END AS effective_text
        FROM translation_workbench wb
      ),
      version_items AS (
        SELECT DISTINCT ON (sc.revision_id, sc.unit_id)
          sc.revision_id AS id,
          src.game_version AS "version",
          src.revision,
          wb.latest_change_status,
          wb.approved_for_current_source,
          wb.effective_text
        FROM source_changes sc
        JOIN source_revision_change_summary src ON src.revision_id = sc.revision_id
        JOIN workbench wb ON wb.unit_id = sc.unit_id
        WHERE src.total_changes > 0
          AND sc.change_type IN ('added', 'modified')
        ORDER BY sc.revision_id, sc.unit_id, sc.created_at DESC
      )
      SELECT
        id,
        "version",
        revision,
        count(*)::int AS total,
        count(*) FILTER (
          WHERE effective_text IS NOT NULL
            AND latest_change_status IS DISTINCT FROM 'pending'
            AND approved_for_current_source IS TRUE
        )::int AS success,
        count(*) FILTER (
          WHERE effective_text IS NOT NULL
            AND latest_change_status = 'pending'
        )::int AS info,
        count(*) FILTER (
          WHERE effective_text IS NOT NULL
            AND latest_change_status IS DISTINCT FROM 'pending'
            AND approved_for_current_source IS NOT TRUE
        )::int AS warning,
        count(*) FILTER (WHERE effective_text IS NULL)::int AS untranslated
      FROM version_items
      GROUP BY id, "version", revision
      ORDER BY "version" DESC, revision DESC, id DESC
    `
  ])

  const categories: EditorCategoryProgress[] = rows.map((row) => {
    const counts = toCounts(row)

    return {
      category: row.category,
      total: Number(row.total || 0),
      counts
    }
  })

  const versions: EditorVersionProgress[] = versionRows.map(row => ({
    id: row.id,
    version: row.version,
    revision: row.revision,
    total: Number(row.total || 0),
    counts: toCounts(row)
  }))

  const overallCounts = categories.reduce<EditorProgressCounts>((counts, category) => {
    counts.success += category.counts.success
    counts.info += category.counts.info
    counts.warning += category.counts.warning
    counts.untranslated += category.counts.untranslated
    return counts
  }, emptyCounts())

  const overallTotal = categories.reduce((total, category) => total + category.total, 0)

  return {
    overall: toSummary(overallTotal, overallCounts),
    categories,
    versions
  }
}
