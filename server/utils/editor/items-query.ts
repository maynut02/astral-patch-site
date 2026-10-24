import type { EditorItem, EditorItemsResponse } from '#shared/types/editor'
import type { DatabaseClient } from '../database'
import { getDatabase } from '../database'
import { containsLikePattern } from '../validation'
import { effectiveWorkbenchText } from './sql'
import type { EditorQueryFilters } from './filters'

export const EDITOR_PAGE_SIZE = 50

function buildWhere(sql: DatabaseClient, filters: EditorQueryFilters) {
  const hasSearch = Boolean(filters.search)
  const hasCategory = Boolean(filters.category)
  const hasRevision = Boolean(filters.revisionId)
  const hasVersion = Boolean(filters.version && filters.revision)
  const hasItem = Boolean(filters.itemId)
  const hasItems = filters.itemIds !== null
  const hasStatusFilter = filters.statusFilter !== 'all'
  const searchPattern = containsLikePattern(filters.search)
  const searchByContains = filters.searchMatch === 'contains'
  const searchByExact = filters.searchMatch === 'exact'
  const searchByContent = filters.searchType === 'content'
  const searchByAll = filters.searchType === 'all'
  const searchByKey = filters.searchType === 'key'
  const searchBySource = filters.searchType === 'source'
  const searchByTranslation = filters.searchType === 'translation'
  const revisionId = filters.revisionId || null
  const itemId = filters.itemId || null
  const itemIds = filters.itemIds ?? []
  const itemIdsArray = sql.array(itemIds)
  const statusIsUntranslated = filters.statusFilter === 'untranslated'
  const statusIsPending = filters.statusFilter === 'pending'
  const statusIsWarning = filters.statusFilter === 'warning'

  return sql`
    (
      NOT ${hasSearch}
      OR (
        (
          ${searchByAll || searchByContent || searchBySource}
          AND (
            (
              ${searchByExact}
              AND (
                LOWER(COALESCE(wb.cn_s, '')) = LOWER(${filters.search})
                OR LOWER(COALESCE(wb.en, '')) = LOWER(${filters.search})
                OR LOWER(COALESCE(wb.jp, '')) = LOWER(${filters.search})
                OR LOWER(COALESCE(wb.cn_t, '')) = LOWER(${filters.search})
              )
            )
            OR (
              ${searchByContains}
              AND (
                COALESCE(wb.cn_s, '') ILIKE ${searchPattern} ESCAPE '\\'
                OR COALESCE(wb.en, '') ILIKE ${searchPattern} ESCAPE '\\'
                OR COALESCE(wb.jp, '') ILIKE ${searchPattern} ESCAPE '\\'
                OR COALESCE(wb.cn_t, '') ILIKE ${searchPattern} ESCAPE '\\'
              )
            )
          )
        )
        OR (
          ${searchByAll || searchByContent || searchByTranslation}
          AND (
            (
              ${searchByExact}
              AND LOWER(
                ${effectiveWorkbenchText(sql)}
              ) = LOWER(${filters.search})
            )
            OR (
              ${searchByContains}
              AND (
                ${effectiveWorkbenchText(sql)}
              ) ILIKE ${searchPattern} ESCAPE '\\'
            )
          )
        )
        OR (
          ${searchByAll || searchByKey}
          AND (
            (
              ${searchByExact}
              AND LOWER(CONCAT(COALESCE(wb.namespace, ''), '_', COALESCE(wb.unit_key, ''))) = LOWER(${filters.search})
            )
            OR (
              ${searchByContains}
              AND CONCAT(COALESCE(wb.namespace, ''), '_', COALESCE(wb.unit_key, '')) ILIKE ${searchPattern} ESCAPE '\\'
            )
          )
        )
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
      NOT ${hasItems}
      OR (
        ${itemIds.length > 0}
        AND wb.unit_id = ANY(${itemIdsArray}::uuid[])
      )
    )
    AND (
      NOT ${filters.untranslatedOnly}
      OR (
        wb.latest_change_status IS DISTINCT FROM 'pending'
        AND NULLIF(BTRIM(wb.approved_text), '') IS NULL
      )
    )
    AND (
      NOT ${hasStatusFilter}
      OR (
        (
          ${statusIsUntranslated}
          AND wb.latest_change_status IS DISTINCT FROM 'pending'
          AND NULLIF(BTRIM(wb.approved_text), '') IS NULL
        )
        OR (
          ${statusIsPending}
          AND wb.latest_change_status = 'pending'
        )
        OR (
          ${statusIsWarning}
          AND wb.latest_change_status IS DISTINCT FROM 'pending'
          AND NULLIF(BTRIM(wb.approved_text), '') IS NOT NULL
          AND wb.approved_for_current_source IS NOT TRUE
        )
      )
    )
  `
}

export async function getEditorItems(filters: EditorQueryFilters): Promise<EditorItemsResponse> {
  const database = getDatabase()
  const offset = (filters.page - 1) * EDITOR_PAGE_SIZE
  const where = buildWhere(database, filters)
  const rows = await database<(EditorItem & { total: number })[]>`
      SELECT
        count(*) OVER()::int AS total,
        wb.unit_id AS id,
        wb.kind,
        wb.namespace AS category,
        wb.unit_key AS "unitKey",
        wb.source_version_id AS "sourceVersionId",
        COALESCE(wb.cn_s, '') AS "cnS",
        COALESCE(wb.en, '') AS en,
        COALESCE(wb.jp, '') AS jp,
        COALESCE(wb.cn_t, '') AS "cnT",
        ${effectiveWorkbenchText(database)} AS ko,
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
      WHERE ${where}
      ORDER BY wb.namespace ASC, wb.unit_key ASC, wb.unit_id ASC
      LIMIT ${EDITOR_PAGE_SIZE}
      OFFSET ${offset}
    `
  // 범위를 벗어난 페이지도 기존 응답과 같은 전체 건수를 반환한다.
  const total = rows[0]?.total ?? Number((await database<{ total: number }[]>`
    SELECT count(*)::int AS total FROM translation_workbench wb WHERE ${where}
  `)[0]?.total || 0)
  const items = rows.map(({ total: _total, ...item }) => item)

  return {
    items,
    total,
    page: filters.page,
    pageSize: EDITOR_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / EDITOR_PAGE_SIZE))
  }
}
