import { createError } from 'h3'
import type { EditorBatchReviewResponse, EditorReviewAction } from '#shared/types/editor'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { assertEditorReviewPermission, parseEditorChangeId, reviewEditorChange } from '../../../utils/editor-approval'
import { assertEditorReviewRateLimit } from '../../../utils/editor-rate-limit'
import { readJsonBody } from '../../../utils/request-security'

const MAX_BATCH_ITEMS = 50

interface BatchReviewInput extends Record<string, unknown> {
  ids?: unknown
  action?: unknown
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

function getReviewErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Translation review could not be completed'
  }

  const value = error as { statusMessage?: unknown, message?: unknown }

  if (typeof value.statusMessage === 'string' && value.statusMessage.trim()) {
    return value.statusMessage
  }

  if (typeof value.message === 'string' && value.message.trim()) {
    return value.message
  }

  return 'Translation review could not be completed'
}

export default defineEventHandler(async (event): Promise<EditorBatchReviewResponse> => {
  const user = await requireCurrentSessionUser(event)
  assertEditorReviewPermission(user)

  const body = await readJsonBody<BatchReviewInput>(event)
  const action = parseReviewAction(body.action)

  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > MAX_BATCH_ITEMS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Batch must contain between 1 and ${MAX_BATCH_ITEMS} change ids`
    })
  }

  const changeIds = body.ids.map(parseEditorChangeId)

  if (new Set(changeIds).size !== changeIds.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Batch contains duplicate change ids'
    })
  }

  await assertEditorReviewRateLimit(user.id, changeIds.length)

  const results: EditorBatchReviewResponse['results'] = []

  // 기존 단건 검토 트랜잭션을 순차 실행해 승인 경합과 DB 부하를 제한한다.
  for (const changeId of changeIds) {
    try {
      const response = await reviewEditorChange(changeId, user.id, { action })
      results.push({
        changeId,
        ok: true,
        response,
        error: null
      })
    } catch (error: unknown) {
      results.push({
        changeId,
        ok: false,
        response: null,
        error: getReviewErrorMessage(error)
      })
    }
  }

  return { results }
})
