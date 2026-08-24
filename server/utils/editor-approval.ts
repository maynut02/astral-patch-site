import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { ensureBotWorkMigration } from './auth-user'
import { getDatabase } from './database'
import type { EditorReviewAction, EditorReviewResponse } from '../../shared/types/editor'

interface PendingEditorChange {
  id: string
  unitId: string
  locale: string
  sourceVersionId: string
  proposedText: string
  status: 'pending' | 'approved' | 'rejected' | 'superseded'
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseEditorChangeId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid translation change id'
    })
  }

  return value
}

function parseReviewAction(value: unknown): EditorReviewAction {
  if (value !== 'approve' && value !== 'reject') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Review action must be approve or reject'
    })
  }

  return value
}

export async function reviewEditorChange(
  changeId: string,
  adminId: string,
  input: { action?: unknown }
): Promise<EditorReviewResponse> {
  const action = parseReviewAction(input.action)
  const database = getDatabase()
  await ensureBotWorkMigration(database)

  return database.begin(async (transaction) => {
    const [change] = await transaction<PendingEditorChange[]>`
      SELECT
        id,
        unit_id AS "unitId",
        locale,
        source_version_id AS "sourceVersionId",
        proposed_text AS "proposedText",
        status
      FROM translation_changes
      WHERE id = ${changeId}
      FOR UPDATE
    `

    if (!change) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Translation change could not be found'
      })
    }

    if (change.status !== 'pending') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Translation change has already been reviewed'
      })
    }

    const nextStatus = action === 'approve' ? 'approved' : 'rejected'

    await transaction`
      UPDATE translation_changes
      SET
        status = ${nextStatus},
        reviewed_by = ${adminId},
        reviewed_at = now()
      WHERE id = ${change.id}
    `

    if (action === 'approve') {
      await transaction`
        INSERT INTO translations (
          id,
          unit_id,
          locale,
          text,
          approved_source_version_id,
          applied_change_id,
          approved_by,
          approved_at,
          updated_at
        )
        VALUES (
          ${randomUUID()},
          ${change.unitId},
          ${change.locale},
          ${change.proposedText},
          ${change.sourceVersionId},
          ${change.id},
          ${adminId},
          now(),
          now()
        )
        ON CONFLICT (unit_id, locale) DO UPDATE SET
          text = EXCLUDED.text,
          approved_source_version_id = EXCLUDED.approved_source_version_id,
          applied_change_id = EXCLUDED.applied_change_id,
          approved_by = EXCLUDED.approved_by,
          approved_at = EXCLUDED.approved_at,
          updated_at = now()
      `
    }

    return {
      changeId: change.id,
      status: nextStatus
    }
  })
}
