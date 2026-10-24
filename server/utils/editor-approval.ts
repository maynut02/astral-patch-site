import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { isReviewerRole } from '#shared/types/user'
import { getDatabase } from './database'
import { parseUuid } from './validation'
import { broadcastWsMessage } from './ws-hub'
import {
  resolveEditorRole,
  type EditorReviewAction,
  type EditorReviewCandidatesResponse,
  type EditorReviewResponse,
  type EditorTranslationLogEntry
} from '../../shared/types/editor'

interface PendingEditorChange {
  id: string
  unitId: string
  locale: string
  sourceVersionId: string
  proposedText: string
  status: 'pending' | 'approved' | 'rejected' | 'superseded'
}

interface EditorChangeIdentity {
  unitId: string
  locale: string
}

export function parseEditorChangeId(value: unknown): string {
  return parseUuid(value, 'Invalid translation change id')
}

export function parseReviewAction(value: unknown): EditorReviewAction {
  if (value !== 'approve' && value !== 'reject') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Review action must be approve or reject'
    })
  }

  return value
}

export function assertEditorReviewPermission(user: { role?: unknown } | null | undefined): void {
  // 검토 역할 정책과 개별 사전·모드의 소유권 정책은 서로 독립적이다.
  const role = resolveEditorRole(user)

  if (!isReviewerRole(role)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Verified user permission is required to review translations'
    })
  }
}

export async function getPendingEditorReviewCandidates(
  unitIds: string[]
): Promise<EditorReviewCandidatesResponse> {
  const database = getDatabase()
  const unitIdsArray = database.array(unitIds)
  const candidates = await database<EditorTranslationLogEntry[]>`
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
      NULL::text AS "reviewerRole",
      NULL::text AS "reviewerHandle",
      tc.previous_text AS "previousText",
      tc.proposed_text AS "proposedText",
      tc.change_kind AS "changeKind",
      tc.status,
      tc.created_at AS "createdAt",
      tc.reviewed_at AS "reviewedAt"
    FROM translation_changes tc
    JOIN translation_units tu ON tu.id = tc.unit_id
    LEFT JOIN app_users au ON au.google_sub = tc.created_by
    WHERE tc.locale = 'ko'
      AND tc.status = 'pending'
      AND tc.unit_id = ANY(${unitIdsArray}::uuid[])
    ORDER BY tu.namespace ASC, tu.unit_key ASC, tc.created_at DESC, tc.id DESC
  `

  const groups = new Map<string, EditorReviewCandidatesResponse['groups'][number]>()

  for (const candidate of candidates) {
    const current = groups.get(candidate.unitId)
    if (current) {
      current.candidates.push(candidate)
      continue
    }

    groups.set(candidate.unitId, {
      unitId: candidate.unitId,
      kind: candidate.kind,
      category: candidate.category,
      unitKey: candidate.unitKey,
      candidates: [candidate]
    })
  }

  return { groups: [...groups.values()] }
}

export async function reviewEditorChange(
  changeId: string,
  reviewerId: string,
  input: { action?: unknown }
): Promise<EditorReviewResponse> {
  const action = parseReviewAction(input.action)
  const database = getDatabase()

  const result = await database.begin(async (transaction) => {
    const [identity] = await transaction<EditorChangeIdentity[]>`
      SELECT
        unit_id AS "unitId",
        locale
      FROM translation_changes
      WHERE id = ${changeId}
    `

    if (!identity) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Translation change could not be found'
      })
    }

    // 승인 경합과 중간 pending 삽입을 막기 위해 번역 단위 행을 잠근다.
    await transaction`
      SELECT id
      FROM translation_units
      WHERE id = ${identity.unitId}
      FOR UPDATE
    `

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

    const nextStatus: EditorReviewResponse['status'] = action === 'approve' ? 'approved' : 'rejected'
    let supersededChangeIds: string[] = []

    await transaction`
      UPDATE translation_changes
      SET
        status = ${nextStatus},
        reviewed_by = ${reviewerId},
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
          ${reviewerId},
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

      const supersededChanges = await transaction<{ id: string }[]>`
        UPDATE translation_changes
        SET
          status = 'superseded',
          reviewed_by = ${reviewerId},
          reviewed_at = now()
        WHERE unit_id = ${change.unitId}
          AND locale = ${change.locale}
          AND status = 'pending'
          AND id <> ${change.id}
        RETURNING id
      `
      supersededChangeIds = supersededChanges.map(row => row.id)
    }

    return {
      response: {
        changeId: change.id,
        status: nextStatus
      },
      itemId: change.unitId,
      supersededChangeIds
    }
  })

  broadcastWsMessage({
    type: 'EDITOR_ITEM_REVIEWED',
    itemId: result.itemId,
    changeId: result.response.changeId,
    status: result.response.status,
    supersededChangeIds: result.supersededChangeIds
  }, ['editor', 'change:translation'])

  return result.response
}
