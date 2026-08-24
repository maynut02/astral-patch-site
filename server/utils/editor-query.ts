import { createError } from 'h3'
import type { DatabaseClient } from './database'
import { getDatabase } from './database'
import {
  EDITOR_ALL_CATEGORY_VALUE,
  EDITOR_ALL_REVISION_VALUE,
  type EditorFiltersResponse,
  type EditorItem,
  type EditorItemsResponse,
  type EditorSelectOption
} from '../../shared/types/editor'

export const EDITOR_PAGE_SIZE = 50

export interface EditorQueryFilters {
  page: number
  search: string
  category: string
  revisionId: string
  version: string
  revision: string
  itemId: string
  untranslatedOnly: boolean
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
      statusMessage: 'Invalid page'
    })
  }

  return page
}

function parseCategory(value: unknown): string {
  const category = getFirstQueryValue(value).trim()

  return category === EDITOR_ALL_CATEGORY_VALUE ? '' : category
}

function parseRevisionId(value: unknown): string {
  const revisionId = getFirstQueryValue(value)

  if (revisionId === EDITOR_ALL_REVISION_VALUE) {
    return ''
  }

  if (revisionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revisionId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid revision id'
    })
  }

  return revisionId
}

function parseVersion(value: unknown): string {
  return getFirstQueryValue(value).trim().replace(/^v/i, '')
}

function parseRevision(value: unknown): string {
  return getFirstQueryValue(value).trim().replace(/^r/i, '')
}

function parseItemId(value: unknown): string {
  const itemId = getFirstQueryValue(value)

  if (itemId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid item id'
    })
  }

  return itemId
}

export function parseEditorQuery(query: Record<string, unknown>): EditorQueryFilters {
  const search = getFirstQueryValue(query.search).trim()
  const category = parseCategory(query.category)
  const revisionId = parseRevisionId(query.revisionId)
  const version = parseVersion(query.version)
  const revision = parseRevision(query.revision)
  const untranslated = getFirstQueryValue(query.untranslated).toLowerCase()

  if (search.length > 200 || category.length > 200 || version.length > 100 || revision.length > 100) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Filter value is too long'
    })
  }

  if (Boolean(version) !== Boolean(revision)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Version and revision must be provided together'
    })
  }

  return {
    page: parsePage(query.page),
    search,
    category,
    revisionId,
    version,
    revision,
    itemId: parseItemId(query.itemId),
    untranslatedOnly: untranslated === 'true' || untranslated === '1' || untranslated === 'on'
  }
}

function buildWhere(sql: DatabaseClient, filters: EditorQueryFilters) {
  const hasSearch = Boolean(filters.search)
  const hasCategory = Boolean(filters.category)
  const hasRevision = Boolean(filters.revisionId)
  const hasVersion = Boolean(filters.version && filters.revision)
  const hasItem = Boolean(filters.itemId)
  const searchPattern = `%${filters.search}%`
  const revisionId = filters.revisionId || null
  const itemId = filters.itemId || null

  return sql`
    (
      NOT ${hasSearch}
      OR (
        COALESCE(wb.cn_s, '') ILIKE ${searchPattern}
        OR COALESCE(wb.en, '') ILIKE ${searchPattern}
        OR COALESCE(wb.jp, '') ILIKE ${searchPattern}
        OR COALESCE(wb.cn_t, '') ILIKE ${searchPattern}
        OR CONCAT(COALESCE(wb.namespace, ''), '_', COALESCE(wb.unit_key, '')) ILIKE ${searchPattern}
        OR (
          CASE
            WHEN wb.latest_change_status = 'pending'
              THEN COALESCE(wb.latest_proposed_text, wb.approved_text, '')
            ELSE COALESCE(wb.approved_text, '')
          END
        ) ILIKE ${searchPattern}
      )
    )
    AND (
      NOT ${hasCategory}
      OR wb.namespace = ${filters.category || null}
    )
    AND (
      NOT ${hasRevision}
      OR EXISTS (
        SELECT 1
        FROM source_changes sc
        WHERE sc.unit_id = wb.unit_id
          AND sc.revision_id = ${revisionId}
        AND sc.change_type IN ('added', 'modified')
      )
    )
    AND (
      NOT ${hasVersion}
      OR EXISTS (
        SELECT 1
        FROM source_changes sc
        JOIN source_revision_change_summary src ON src.revision_id = sc.revision_id
        WHERE sc.unit_id = wb.unit_id
          AND src.game_version = ${filters.version || null}
          AND src.revision = ${filters.revision || null}
          AND sc.change_type IN ('added', 'modified')
      )
    )
    AND (
      NOT ${hasItem}
      OR wb.unit_id = ${itemId}
    )
    AND (
      NOT ${filters.untranslatedOnly}
      OR NULLIF(BTRIM(wb.approved_text), '') IS NULL
    )
  `
}

export async function getEditorItems(filters: EditorQueryFilters): Promise<EditorItemsResponse> {
  const database = getDatabase()
  const offset = (filters.page - 1) * EDITOR_PAGE_SIZE
  const countWhere = buildWhere(database, filters)
  const itemsWhere = buildWhere(database, filters)

  const [countRows, items] = await Promise.all([
    database<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM translation_workbench wb
      WHERE ${countWhere}
    `,
    database<EditorItem[]>`
      SELECT
        wb.unit_id AS id,
        wb.kind,
        wb.namespace AS category,
        wb.unit_key AS "unitKey",
        wb.source_version_id AS "sourceVersionId",
        COALESCE(wb.cn_s, '') AS "cnS",
        COALESCE(wb.en, '') AS en,
        COALESCE(wb.jp, '') AS jp,
        COALESCE(wb.cn_t, '') AS "cnT",
        CASE
          WHEN wb.latest_change_status = 'pending'
            THEN COALESCE(wb.latest_proposed_text, wb.approved_text, '')
          ELSE COALESCE(wb.approved_text, '')
        END AS ko,
        CASE
          WHEN wb.latest_change_status = 'pending' THEN wb.latest_proposed_text
          ELSE NULL
        END AS "pendingKo",
        CASE
          WHEN wb.latest_change_status = 'pending' THEN wb.latest_change_status
          ELSE NULL
        END AS "pendingStatus",
        wb.approved_for_current_source AS "approvedForCurrentSource"
      FROM translation_workbench wb
      WHERE ${itemsWhere}
      ORDER BY wb.namespace ASC, wb.unit_key ASC, wb.unit_id ASC
      LIMIT ${EDITOR_PAGE_SIZE}
      OFFSET ${offset}
    `
  ])

  const total = Number(countRows[0]?.total || 0)

  return {
    items,
    total,
    page: filters.page,
    pageSize: EDITOR_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / EDITOR_PAGE_SIZE))
  }
}

export async function getEditorFilters(): Promise<EditorFiltersResponse> {
  const database = getDatabase()

  const [categoryRows, revisionRows] = await Promise.all([
    database<{ value: string }[]>`
      SELECT DISTINCT namespace AS value
      FROM translation_units
      WHERE NULLIF(BTRIM(namespace), '') IS NOT NULL
      ORDER BY namespace ASC
    `,
    database<{ value: string, gameVersion: string, revision: string }[]>`
      SELECT
        revision_id AS value,
        game_version AS "gameVersion",
        revision
      FROM source_revision_change_summary
      WHERE total_changes > 0
      ORDER BY detected_at DESC, game_version DESC, revision DESC, revision_id DESC
    `
  ])

  const categories: EditorSelectOption[] = [
    { label: '전체', value: EDITOR_ALL_CATEGORY_VALUE },
    ...categoryRows
      .filter(row => row.value.trim() && row.value !== EDITOR_ALL_CATEGORY_VALUE)
      .map(row => ({
        label: row.value,
        value: row.value
      }))
  ]
  const revisions: EditorSelectOption[] = [
    { label: '전체', value: EDITOR_ALL_REVISION_VALUE },
    ...revisionRows
      .filter(row => row.value.trim() && row.value !== EDITOR_ALL_REVISION_VALUE)
      .map(row => ({
        label: `${row.gameVersion.startsWith('v') ? row.gameVersion : `v${row.gameVersion}`}_${row.revision.startsWith('r') ? row.revision : `r${row.revision}`}`,
        value: row.value
      }))
  ]

  return { categories, revisions }
}
