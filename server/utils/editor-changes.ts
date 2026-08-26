import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { BOT_HANDLE } from './auth-user'
import { getDatabase } from './database'
import { getTextLength, parseUuid } from './validation'
import type { EditorChangeStatus, EditorHistoryResponse, EditorSaveResponse } from '../../shared/types/editor'

const MAX_TRANSLATION_CHARACTERS = 10_000

interface CurrentEditorTranslation {
  sourceVersionId: string | null
  currentText: string
  currentStatus: EditorChangeStatus | null
}

interface RetainableEditorTranslation {
  sourceVersionId: string | null
  approvedSourceVersionId: string | null
  approvedText: string
  matchingPendingChangeId: string | null
}

export interface SaveEditorTranslationInput {
  text?: unknown
}

export function parseEditorUnitId(value: unknown): string {
  return parseUuid(value, 'Invalid editor item id')
}

function parseTranslationText(value: unknown): string {
  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Translation text is required'
    })
  }

  const text = value.trim()

  if (!text) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Translation text cannot be empty'
    })
  }

  if (getTextLength(text) > MAX_TRANSLATION_CHARACTERS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Translation text must be ${MAX_TRANSLATION_CHARACTERS} characters or fewer`
    })
  }

  return text
}

export async function saveEditorTranslation(
  unitId: string,
  userId: string,
  input: SaveEditorTranslationInput
): Promise<EditorSaveResponse> {
  const proposedText = parseTranslationText(input.text)
  const database = getDatabase()

  return database.begin(async (transaction) => {
    const [current] = await transaction<CurrentEditorTranslation[]>`
      SELECT
        tu.current_source_version_id AS "sourceVersionId",
        COALESCE(latest_pending.proposed_text, tr.text, '') AS "currentText",
        CASE WHEN latest_pending.id IS NOT NULL THEN 'pending'::text ELSE NULL::text END AS "currentStatus"
      FROM translation_units tu
      LEFT JOIN translations tr
        ON tr.unit_id = tu.id AND tr.locale = 'ko'
      LEFT JOIN LATERAL (
        SELECT tc.id, tc.proposed_text
        FROM translation_changes tc
        WHERE tc.unit_id = tu.id
          AND tc.locale = 'ko'
          AND tc.status = 'pending'
          AND tc.source_version_id = tu.current_source_version_id
        ORDER BY tc.created_at DESC, tc.id DESC
        LIMIT 1
      ) latest_pending ON TRUE
      WHERE tu.id = ${unitId}
      FOR UPDATE OF tu
    `

    if (!current) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Editor item could not be found'
      })
    }

    if (!current.sourceVersionId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Editor item has no current source version'
      })
    }

    if (proposedText === current.currentText) {
      return {
        changed: false,
        changeId: null,
        ko: current.currentText,
        status: current.currentStatus
      }
    }

    const groupId = randomUUID()
    const changeId = randomUUID()

    await transaction`
      INSERT INTO translation_change_groups (
        id,
        title,
        created_by
      )
      VALUES (
        ${groupId},
        '번역 에디터 수정',
        ${userId}
      )
    `

    await transaction`
      INSERT INTO translation_changes (
        id,
        group_id,
        unit_id,
        locale,
        source_version_id,
        previous_text,
        proposed_text,
        status,
        created_by
      )
      VALUES (
        ${changeId},
        ${groupId},
        ${unitId},
        'ko',
        ${current.sourceVersionId},
        ${current.currentText || null},
        ${proposedText},
        'pending',
        ${userId}
      )
    `

    return {
      changed: true,
      changeId,
      ko: proposedText,
      status: 'pending' as const
    }
  })
}

export async function retainEditorTranslation(unitId: string, userId: string): Promise<EditorSaveResponse> {
  const database = getDatabase()

  return database.begin(async (transaction) => {
    const [current] = await transaction<RetainableEditorTranslation[]>`
      SELECT
        tu.current_source_version_id AS "sourceVersionId",
        tr.approved_source_version_id AS "approvedSourceVersionId",
        COALESCE(tr.text, '') AS "approvedText",
        matching_pending.id AS "matchingPendingChangeId"
      FROM translation_units tu
      LEFT JOIN translations tr
        ON tr.unit_id = tu.id AND tr.locale = 'ko'
      LEFT JOIN LATERAL (
        SELECT tc.id
        FROM translation_changes tc
        WHERE tc.unit_id = tu.id
          AND tc.locale = 'ko'
          AND tc.status = 'pending'
          AND tc.source_version_id = tu.current_source_version_id
          AND tc.proposed_text = tr.text
        ORDER BY tc.created_at DESC, tc.id DESC
        LIMIT 1
      ) matching_pending ON TRUE
      WHERE tu.id = ${unitId}
      FOR UPDATE OF tu
    `

    if (!current) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Editor item could not be found'
      })
    }

    if (!current.sourceVersionId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Editor item has no current source version'
      })
    }

    const approvedText = current.approvedText.trim()

    if (!approvedText || !current.approvedSourceVersionId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'There is no approved translation to retain'
      })
    }

    if (current.approvedSourceVersionId === current.sourceVersionId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'This translation is already confirmed for the current source'
      })
    }

    if (current.matchingPendingChangeId) {
      return {
        changed: false,
        changeId: current.matchingPendingChangeId,
        ko: current.approvedText,
        status: 'pending'
      }
    }

    const groupId = randomUUID()
    const changeId = randomUUID()

    await transaction`
      INSERT INTO translation_change_groups (id, title, created_by)
      VALUES (${groupId}, '현재 번역 유지 확인', ${userId})
    `

    await transaction`
      INSERT INTO translation_changes (
        id,
        group_id,
        unit_id,
        locale,
        source_version_id,
        previous_text,
        proposed_text,
        status,
        created_by
      )
      VALUES (
        ${changeId},
        ${groupId},
        ${unitId},
        'ko',
        ${current.sourceVersionId},
        ${current.approvedText},
        ${current.approvedText},
        'pending',
        ${userId}
      )
    `

    return {
      changed: true,
      changeId,
      ko: current.approvedText,
      status: 'pending'
    }
  })
}

export async function getEditorHistory(unitId: string): Promise<EditorHistoryResponse> {
  const database = getDatabase()

  const entries = await database<EditorHistoryResponse['entries']>`
    SELECT *
    FROM (
      SELECT
        concat('source:', sc.revision_id::text, ':', sc.unit_id::text) AS id,
        'source_changed'::text AS action,
        CASE WHEN source_creator."role" = 'bot' THEN 'automation'::text ELSE 'user'::text END AS "actorType",
        source_creator."role"::text AS "actorRole",
        COALESCE(NULLIF(BTRIM(source_creator.handle), ''), ${BOT_HANDLE}) AS handle,
        NULL::text AS status,
        NULL::text AS "reviewerRole",
        NULL::text AS "reviewerHandle",
        NULL AS "reviewedAt",
        sc.change_type::text AS "changeType",
        src.game_version AS version,
        src.revision AS revision,
        NULL::text AS "previousText",
        NULL::text AS "proposedText",
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
      JOIN source_revision_change_summary src ON src.revision_id = sc.revision_id
      JOIN app_users source_creator ON source_creator.google_sub = sc.created_by
      LEFT JOIN source_versions old_sv ON old_sv.id = sc.old_source_version_id
      LEFT JOIN source_versions new_sv ON new_sv.id = sc.new_source_version_id
      WHERE sc.unit_id = ${unitId}

      UNION ALL

      SELECT
        concat(tc.id::text, ':translation') AS id,
        'translation_changed'::text AS action,
        CASE WHEN creator."role" = 'bot' THEN 'automation'::text ELSE 'user'::text END AS "actorType",
        creator."role"::text AS "actorRole",
        NULLIF(BTRIM(creator.handle), '') AS handle,
        tc.status::text AS status,
        reviewer."role"::text AS "reviewerRole",
        NULLIF(BTRIM(reviewer.handle), '') AS "reviewerHandle",
        tc.reviewed_at AS "reviewedAt",
        NULL::text AS "changeType",
        NULL::text AS version,
        NULL::text AS revision,
        tc.previous_text AS "previousText",
        tc.proposed_text AS "proposedText",
        NULL::text AS "beforeCnS",
        NULL::text AS "beforeEn",
        NULL::text AS "beforeJp",
        NULL::text AS "beforeCnT",
        NULL::text AS "afterCnS",
        NULL::text AS "afterEn",
        NULL::text AS "afterJp",
        NULL::text AS "afterCnT",
        tc.created_at AS "createdAt"
      FROM translation_changes tc
      JOIN app_users creator ON creator.google_sub = tc.created_by
      LEFT JOIN app_users reviewer ON reviewer.google_sub = tc.reviewed_by
      WHERE tc.unit_id = ${unitId}
        AND tc.locale = 'ko'
    ) AS history
    ORDER BY "createdAt" DESC, id DESC
  `

  return { entries }
}
