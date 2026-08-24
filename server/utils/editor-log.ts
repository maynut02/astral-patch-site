import { createError } from 'h3'
import { ensureBotWorkMigration } from './auth-user'
import { getDatabase, type DatabaseClient } from './database'
import type {
  EditorChangeStatus,
  EditorSourceChangesResponse,
  EditorSourceRevision,
  EditorSourceRevisionsResponse,
  EditorTranslationLogResponse
} from '../../shared/types/editor'

export const EDITOR_LOG_PAGE_SIZE = 50

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHANGE_STATUSES: EditorChangeStatus[] = ['pending', 'approved', 'rejected', 'superseded']

export interface EditorTranslationLogFilters {
  page: number
  search: string
  status: EditorChangeStatus | ''
}

function getFirstQueryValue(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

function parsePage(value: unknown): number {
  const page = Number(getFirstQueryValue(value) || '1')

  if (!Number.isInteger(page) || page < 1 || page > 100000) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid log page'
    })
  }

  return page
}

export function parseEditorLogQuery(query: Record<string, unknown>): EditorTranslationLogFilters {
  const search = getFirstQueryValue(query.search).trim()
  const rawStatus = getFirstQueryValue(query.status).trim().toLowerCase()

  if (search.length > 200) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Log search value is too long'
    })
  }

  if (rawStatus && rawStatus !== 'all' && !CHANGE_STATUSES.includes(rawStatus as EditorChangeStatus)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid log status'
    })
  }

  return {
    page: parsePage(query.page),
    search,
    status: rawStatus === 'all' ? '' : rawStatus as EditorChangeStatus | ''
  }
}

export function parseEditorLogRevisionId(value: unknown): string {
  const revisionId = getFirstQueryValue(value)

  if (!UUID_PATTERN.test(revisionId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid source revision id'
    })
  }

  return revisionId
}

function buildTranslationLogWhere(sql: DatabaseClient, filters: EditorTranslationLogFilters) {
  const hasSearch = Boolean(filters.search)
  const hasStatus = Boolean(filters.status)
  const searchPattern = `%${filters.search}%`

  return sql`
    tc.locale = 'ko'
    AND (
      NOT ${hasSearch}
      OR tu.namespace ILIKE ${searchPattern}
      OR tu.unit_key ILIKE ${searchPattern}
      OR COALESCE(au.nickname, '') ILIKE ${searchPattern}
      OR COALESCE(tc.previous_text, '') ILIKE ${searchPattern}
      OR tc.proposed_text ILIKE ${searchPattern}
    )
    AND (
      NOT ${hasStatus}
      OR tc.status = ${filters.status || null}
    )
  `
}

export async function getEditorTranslationLogs(
  filters: EditorTranslationLogFilters
): Promise<EditorTranslationLogResponse> {
  const database = getDatabase()
  await ensureBotWorkMigration(database)

  const offset = (filters.page - 1) * EDITOR_LOG_PAGE_SIZE
  const where = buildTranslationLogWhere(database, filters)

  const [countRows, entries] = await Promise.all([
    database<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM translation_changes tc
      JOIN translation_units tu ON tu.id = tc.unit_id
      LEFT JOIN app_users au ON au.google_sub = tc.created_by
      WHERE ${where}
    `,
    database<EditorTranslationLogResponse['entries']>`
      SELECT
        tc.id,
        tc.unit_id AS "unitId",
        tu.kind,
        tu.namespace AS category,
        tu.unit_key AS "unitKey",
        COALESCE(NULLIF(BTRIM(au.nickname), ''), '알 수 없는 사용자') AS nickname,
        tc.previous_text AS "previousText",
        tc.proposed_text AS "proposedText",
        tc.status,
        tc.created_at AS "createdAt",
        tc.reviewed_at AS "reviewedAt"
      FROM translation_changes tc
      JOIN translation_units tu ON tu.id = tc.unit_id
      LEFT JOIN app_users au ON au.google_sub = tc.created_by
      WHERE ${where}
      ORDER BY tc.created_at DESC, tc.id DESC
      LIMIT ${EDITOR_LOG_PAGE_SIZE}
      OFFSET ${offset}
    `
  ])

  const total = Number(countRows[0]?.total || 0)

  return {
    entries,
    total,
    page: filters.page,
    pageSize: EDITOR_LOG_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / EDITOR_LOG_PAGE_SIZE))
  }
}

interface SourceRevisionRow extends Omit<EditorSourceRevision, 'totalChanges' | 'addedCount' | 'modifiedCount' | 'removedCount'> {
  totalChanges: number | string
  addedCount: number | string
  modifiedCount: number | string
  removedCount: number | string
}

export async function getEditorSourceRevisions(): Promise<EditorSourceRevisionsResponse> {
  const database = getDatabase()
  await ensureBotWorkMigration(database)
  const rows = await database<SourceRevisionRow[]>`
    SELECT
      revision_id AS id,
      game_version AS "gameVersion",
      revision,
      detected_at AS "detectedAt",
      processed_at AS "processedAt",
      total_changes::int AS "totalChanges",
      added_count::int AS "addedCount",
      modified_count::int AS "modifiedCount",
      removed_count::int AS "removedCount"
    FROM source_revision_change_summary
    WHERE total_changes > 0
    ORDER BY detected_at DESC, game_version DESC, revision DESC, revision_id DESC
  `

  return {
    revisions: rows.map(row => ({
      ...row,
      totalChanges: Number(row.totalChanges),
      addedCount: Number(row.addedCount),
      modifiedCount: Number(row.modifiedCount),
      removedCount: Number(row.removedCount)
    }))
  }
}

export async function getEditorSourceChanges(
  revisionId: string,
  page: number
): Promise<EditorSourceChangesResponse> {
  const database = getDatabase()
  await ensureBotWorkMigration(database)
  const offset = (page - 1) * EDITOR_LOG_PAGE_SIZE

  const [countRows, entries] = await Promise.all([
    database<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM source_changes sc
      WHERE sc.revision_id = ${revisionId}
    `,
    database<EditorSourceChangesResponse['entries']>`
      SELECT
        concat(sc.revision_id, ':', sc.unit_id) AS id,
        sc.revision_id AS "revisionId",
        sc.unit_id AS "unitId",
        tu.kind,
        tu.namespace AS category,
        tu.unit_key AS "unitKey",
        sc.change_type AS "changeType",
        old_sv.cn_s AS "beforeCnS",
        old_sv.en AS "beforeEn",
        old_sv.jp AS "beforeJp",
        old_sv.cn_t AS "beforeCnT",
        new_sv.cn_s AS "afterCnS",
        new_sv.en AS "afterEn",
        new_sv.jp AS "afterJp",
        new_sv.cn_t AS "afterCnT",
        sc.created_at AS "createdAt"
      FROM source_changes sc
      JOIN translation_units tu ON tu.id = sc.unit_id
      LEFT JOIN source_versions old_sv ON old_sv.id = sc.old_source_version_id
      LEFT JOIN source_versions new_sv ON new_sv.id = sc.new_source_version_id
      WHERE sc.revision_id = ${revisionId}
      ORDER BY tu.namespace ASC, tu.unit_key ASC, sc.unit_id ASC
      LIMIT ${EDITOR_LOG_PAGE_SIZE}
      OFFSET ${offset}
    `
  ])

  const total = Number(countRows[0]?.total || 0)

  return {
    entries,
    total,
    page,
    pageSize: EDITOR_LOG_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / EDITOR_LOG_PAGE_SIZE))
  }
}
