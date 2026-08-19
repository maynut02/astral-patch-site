import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { ensureUsersTable } from './auth-user'
import { getDatabase } from './database'
import type { EditorChangeStatus, EditorHistoryResponse, EditorSaveResponse } from '../../shared/types/editor'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface CurrentEditorTranslation {
  sourceVersionId: string | null
  currentText: string
  currentStatus: EditorChangeStatus | null
}

export interface SaveEditorTranslationInput {
  text?: unknown
  expectedText?: unknown
}

export function parseEditorUnitId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid editor item id'
    })
  }

  return value
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

  return text
}

function parseExpectedText(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid expected translation text'
    })
  }

  return value
}

export async function saveEditorTranslation(
  unitId: string,
  userId: string,
  input: SaveEditorTranslationInput
): Promise<EditorSaveResponse> {
  const proposedText = parseTranslationText(input.text)
  const expectedText = parseExpectedText(input.expectedText)
  const database = getDatabase()

  const result = await database.begin(async (transaction) => {
    const [current] = await transaction<CurrentEditorTranslation[]>`
      SELECT
        tu.current_source_version_id AS "sourceVersionId",
        COALESCE(
          CASE
            WHEN latest_change.status = 'pending' THEN latest_change.proposed_text
            ELSE NULL
          END,
          tr.text,
          ''
        ) AS "currentText",
        CASE
          WHEN latest_change.status = 'pending' THEN latest_change.status
          ELSE NULL
        END AS "currentStatus"
      FROM translation_units tu
      LEFT JOIN translations tr
        ON tr.unit_id = tu.id AND tr.locale = 'ko'
      LEFT JOIN LATERAL (
        SELECT tc.status, tc.proposed_text
        FROM translation_changes tc
        WHERE tc.unit_id = tu.id AND tc.locale = 'ko'
        ORDER BY tc.created_at DESC, tc.id DESC
        LIMIT 1
      ) latest_change ON TRUE
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

    if (expectedText !== undefined && expectedText !== current.currentText) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Editor item was changed by another user'
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

  return result
}

export async function getEditorHistory(unitId: string): Promise<EditorHistoryResponse> {
  const database = getDatabase()
  await ensureUsersTable(database)

  const entries = await database<EditorHistoryResponse['entries']>`
    SELECT
      tc.id,
      COALESCE(NULLIF(BTRIM(au.nickname), ''), '알 수 없는 사용자') AS nickname,
      tc.previous_text AS "previousText",
      tc.proposed_text AS "proposedText",
      tc.status,
      tc.created_at AS "createdAt"
    FROM translation_changes tc
    LEFT JOIN app_users au ON au.google_sub = tc.created_by
    WHERE tc.unit_id = ${unitId}
      AND tc.locale = 'ko'
    ORDER BY tc.created_at DESC, tc.id DESC
  `

  return { entries }
}
