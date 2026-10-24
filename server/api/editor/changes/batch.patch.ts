import type { EditorBatchReviewResponse } from '#shared/types/editor'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { assertEditorReviewPermission, parseEditorChangeId, parseReviewAction, reviewEditorChange } from '../../../utils/editor-approval'
import { assertEditorReviewRateLimit } from '../../../utils/editor-rate-limit'
import { readJsonBody } from '../../../utils/request-security'
import { assertUniqueBatch, requireBatchItems, runSequentialBatch } from '../../../utils/batch'
import { statusMessageOf } from '../../../utils/http-errors'

const MAX_BATCH_ITEMS = 50

export default defineEventHandler(async (event): Promise<EditorBatchReviewResponse> => {
  const user = await requireCurrentSessionUser(event)
  assertEditorReviewPermission(user)

  const body = await readJsonBody(event)
  const action = parseReviewAction(body.action)

  const rawIds = requireBatchItems(body.ids, MAX_BATCH_ITEMS, `Batch must contain between 1 and ${MAX_BATCH_ITEMS} change ids`)
  const changeIds = rawIds.map(parseEditorChangeId)

  assertUniqueBatch(changeIds, 'Batch contains duplicate change ids')

  await assertEditorReviewRateLimit(user.id, changeIds.length)

  const results = await runSequentialBatch<string, EditorBatchReviewResponse['results'][number]>(
    changeIds,
    async changeId => ({
      changeId,
      ok: true,
      response: await reviewEditorChange(changeId, user.id, { action }),
      error: null
    }),
    (error, changeId) => ({
      changeId,
      ok: false,
      response: null,
      error: statusMessageOf(error, 'Translation review could not be completed')
    })
  )

  return { results }
})
