import { createError } from 'h3'
import { withDatabaseRetry, type DatabaseClient } from './database'
import { sourceVersionFields, sourceVersionJoins } from './editor/sql'
import type {
  EditorChangeKind,
  EditorChangeStatus,
  EditorSourceChangesResponse,
  EditorSourceRevision,
  EditorSourceRevisionsResponse,
  EditorTranslationLogEntry,
  EditorTranslationLogSummary,
  EditorTranslationLogResponse
} from '../../shared/types/editor'
import { containsLikePattern, getFirstQueryValue, parsePage as parseValidatedPage, parseUuid } from './validation'

export const EDITOR_LOG_PAGE_SIZE = 50

const CHANGE_STATUSES: EditorChangeStatus[] = ['pending', 'approved', 'rejected', 'superseded']
const CHANGE_KINDS: EditorChangeKind[] = ['translation_edit', 'retain_confirmation']

export interface EditorTranslationLogFilters {
  page: number
  search: string
  status: EditorChangeStatus | ''
  changeKind: EditorChangeKind | ''
}

export function parseEditorLogQuery(query: Record<string, unknown>): EditorTranslationLogFilters {
  const search = getFirstQueryValue(query.search).trim()
  const rawStatus = getFirstQueryValue(query.status).trim().toLowerCase()
  const rawChangeKind = getFirstQueryValue(query.changeKind).trim().toLowerCase()

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

  if (rawChangeKind && rawChangeKind !== 'all' && !CHANGE_KINDS.includes(rawChangeKind as EditorChangeKind)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid log change kind'
    })
  }

  return {
    page: parseValidatedPage(query.page, 'Invalid log page'),
    search,
    status: rawStatus === 'all' ? '' : rawStatus as EditorChangeStatus | '',
    changeKind: rawChangeKind === 'all' ? '' : rawChangeKind as EditorChangeKind | ''
  }
}

export function parseEditorLogRevisionId(value: unknown): string {
  const revisionId = getFirstQueryValue(value)

  return parseUuid(revisionId, 'Invalid source revision id')
}

function buildTranslationLogWhere(sql: DatabaseClient, filters: EditorTranslationLogFilters) {
  const hasSearch = Boolean(filters.search)
  const hasStatus = Boolean(filters.status)
  const hasChangeKind = Boolean(filters.changeKind)
  const searchPattern = containsLikePattern(filters.search)

  return sql`
    tc.locale = 'ko'
    AND (
      NOT ${hasSearch}
      OR tu.namespace ILIKE ${searchPattern} ESCAPE '\\'
      OR tu.unit_key ILIKE ${searchPattern} ESCAPE '\\'
      OR COALESCE(au.handle, '') ILIKE ${searchPattern} ESCAPE '\\'
      OR COALESCE(reviewer.handle, '') ILIKE ${searchPattern} ESCAPE '\\'
      OR COALESCE(tc.previous_text, '') ILIKE ${searchPattern} ESCAPE '\\'
      OR tc.proposed_text ILIKE ${searchPattern} ESCAPE '\\'
    )
    AND (
      NOT ${hasStatus}
      OR tc.status = ${filters.status || null}
    )
    AND (
      NOT ${hasChangeKind}
      OR tc.change_kind = ${filters.changeKind || null}
    )
  `
}

interface TranslationLogPageRow {
  total: number | string
  entry: EditorTranslationLogResponse['entries'][number]
}

interface TranslationLogSummaryRow {
  pending: number | string
  approved: number | string
  rejected: number | string
  superseded: number | string
}

export async function getEditorTranslationLogSummary(): Promise<EditorTranslationLogSummary> {
  const rows = await withDatabaseRetry<TranslationLogSummaryRow[]>(database => database<TranslationLogSummaryRow[]>`
    SELECT
      count(*) FILTER (WHERE tc.status = 'pending')::int AS pending,
      count(*) FILTER (WHERE tc.status = 'approved')::int AS approved,
      count(*) FILTER (WHERE tc.status = 'rejected')::int AS rejected,
      count(*) FILTER (WHERE tc.status = 'superseded')::int AS superseded
    FROM translation_changes tc
    JOIN translation_units tu ON tu.id = tc.unit_id
    WHERE tc.locale = 'ko'
  `)

  const row = rows[0]

  return {
    pending: Number(row?.pending || 0),
    approved: Number(row?.approved || 0),
    rejected: Number(row?.rejected || 0),
    superseded: Number(row?.superseded || 0)
  }
}

export async function getEditorTranslationLogs(
  filters: EditorTranslationLogFilters
): Promise<EditorTranslationLogResponse> {
  const offset = (filters.page - 1) * EDITOR_LOG_PAGE_SIZE

  const rows = await withDatabaseRetry<TranslationLogPageRow[]>(async (database) => {
    const where = buildTranslationLogWhere(database, filters)

    return database<TranslationLogPageRow[]>`
      SELECT
        count(*) OVER()::int AS total,
        json_build_object(
          'id', tc.id,
          'unitId', tc.unit_id,
          'kind', tu.kind,
          'category', tu.namespace,
          'unitKey', tu.unit_key,
          'actorRole', CASE
            WHEN au."role" IN ('admin', 'verified', 'user', 'bot') THEN au."role"
            ELSE 'user'::text
          END,
          'handle', NULLIF(BTRIM(au.handle), ''),
          'reviewerRole', CASE
            WHEN reviewer."role" IN ('admin', 'verified', 'user', 'bot') THEN reviewer."role"
            ELSE NULL
          END,
          'reviewerHandle', NULLIF(BTRIM(reviewer.handle), ''),
          'previousText', tc.previous_text,
          'proposedText', tc.proposed_text,
          'changeKind', tc.change_kind,
          'pendingCandidateCount', (
            SELECT count(*)::int
            FROM translation_changes pending
            WHERE pending.unit_id = tc.unit_id
              AND pending.locale = tc.locale
              AND pending.status = 'pending'
          ),
          'status', tc.status,
          'createdAt', tc.created_at,
          'reviewedAt', tc.reviewed_at
        ) AS entry
      FROM translation_changes tc
      JOIN translation_units tu ON tu.id = tc.unit_id
      LEFT JOIN app_users au ON au.google_sub = tc.created_by
      LEFT JOIN app_users reviewer ON reviewer.google_sub = tc.reviewed_by
      WHERE ${where}
      ORDER BY tc.created_at DESC, tc.id DESC
      LIMIT ${EDITOR_LOG_PAGE_SIZE}
      OFFSET ${offset}
    `
  })

  const total = Number(rows[0]?.total || 0)
  const entries = rows.map(row => row.entry)

  return {
    entries,
    total,
    page: filters.page,
    pageSize: EDITOR_LOG_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / EDITOR_LOG_PAGE_SIZE))
  }
}

export async function getEditorTranslationLogEntry(changeId: string): Promise<EditorTranslationLogEntry | null> {
  const rows = await withDatabaseRetry<EditorTranslationLogEntry[]>(database => database<EditorTranslationLogEntry[]>`
    SELECT
      tc.id,
      tc.unit_id AS "unitId",
      tu.kind,
      tu.namespace AS category,
      tu.unit_key AS "unitKey",
      CASE
        WHEN au."role" IN ('admin', 'verified', 'user', 'bot') THEN au."role"
        ELSE 'user'::text
      END AS "actorRole",
      NULLIF(BTRIM(au.handle), '') AS handle,
      CASE
        WHEN reviewer."role" IN ('admin', 'verified', 'user', 'bot') THEN reviewer."role"
        ELSE NULL
      END AS "reviewerRole",
      NULLIF(BTRIM(reviewer.handle), '') AS "reviewerHandle",
      tc.previous_text AS "previousText",
      tc.proposed_text AS "proposedText",
      tc.change_kind AS "changeKind",
      tc.status,
      tc.created_at AS "createdAt",
      tc.reviewed_at AS "reviewedAt"
    FROM translation_changes tc
    JOIN translation_units tu ON tu.id = tc.unit_id
    LEFT JOIN app_users au ON au.google_sub = tc.created_by
    LEFT JOIN app_users reviewer ON reviewer.google_sub = tc.reviewed_by
    WHERE tc.id = ${changeId}
      AND tc.locale = 'ko'
    LIMIT 1
  `)

  return rows[0] ?? null
}

interface SourceRevisionRow extends Omit<EditorSourceRevision, 'totalChanges' | 'addedCount' | 'modifiedCount' | 'removedCount'> {
  totalChanges: number | string
  addedCount: number | string
  modifiedCount: number | string
  removedCount: number | string
}

export async function getEditorSourceRevisions(): Promise<EditorSourceRevisionsResponse> {
  const rows = await withDatabaseRetry<SourceRevisionRow[]>(database => database<SourceRevisionRow[]>`
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
  `)

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

interface SourceChangePageRow {
  total: number | string
  entry: EditorSourceChangesResponse['entries'][number]
}

export async function getEditorSourceChanges(
  revisionId: string,
  page: number
): Promise<EditorSourceChangesResponse> {
  const offset = (page - 1) * EDITOR_LOG_PAGE_SIZE

  const rows = await withDatabaseRetry<SourceChangePageRow[]>(database => database<SourceChangePageRow[]>`
    SELECT
      count(*) OVER()::int AS total,
      json_build_object(
        'id', concat(sc.revision_id, ':', sc.unit_id),
        'revisionId', sc.revision_id,
        'unitId', sc.unit_id,
        'kind', tu.kind,
        'category', tu.namespace,
        'unitKey', tu.unit_key,
        'changeType', sc.change_type,
        ${sourceVersionFields(database, true)},
        'createdAt', sc.created_at
      ) AS entry
    FROM source_changes sc
    JOIN translation_units tu ON tu.id = sc.unit_id
    ${sourceVersionJoins(database)}
    WHERE sc.revision_id = ${revisionId}
    ORDER BY tu.namespace ASC, tu.unit_key ASC, sc.unit_id ASC
    LIMIT ${EDITOR_LOG_PAGE_SIZE}
    OFFSET ${offset}
  `)

  const total = Number(rows[0]?.total || 0)
  const entries = rows.map(row => row.entry)

  return {
    entries,
    total,
    page,
    pageSize: EDITOR_LOG_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / EDITOR_LOG_PAGE_SIZE))
  }
}
