import { createError } from 'h3'
import type { EditorBatchSaveResponse } from '#shared/types/editor'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { parseEditorUnitId, saveEditorTranslation } from '../../../utils/editor-changes'
import { assertEditorMutationRateLimit } from '../../../utils/editor-rate-limit'
import { readJsonBody } from '../../../utils/request-security'
import { assertUniqueBatch, requireBatchItems, runSequentialBatch } from '../../../utils/batch'
import { statusMessageOf } from '../../../utils/http-errors'

const MAX_BATCH_ITEMS = 50

interface BatchSaveItemInput {
  id?: unknown
  text?: unknown
}

export default defineEventHandler(async (event): Promise<EditorBatchSaveResponse> => {
  const user = await requireCurrentSessionUser(event)
  const body = await readJsonBody(event)

  const rawItems = requireBatchItems(body.items, MAX_BATCH_ITEMS, `Batch must contain between 1 and ${MAX_BATCH_ITEMS} items`)

  await assertEditorMutationRateLimit(user.id, rawItems.length)

  const items = rawItems.map((raw): { itemId: string, text: unknown } => {
    if (!raw || typeof raw !== 'object') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid batch item'
      })
    }

    const item = raw as BatchSaveItemInput

    return {
      itemId: parseEditorUnitId(item.id),
      text: item.text
    }
  })

  assertUniqueBatch(items.map(item => item.itemId), 'Batch contains duplicate item ids')

  const results = await runSequentialBatch<typeof items[number], EditorBatchSaveResponse['results'][number]>(
    items,
    async item => ({
      itemId: item.itemId,
      ok: true,
      response: await saveEditorTranslation(item.itemId, user.id, { text: item.text }),
      error: null
    }),
    (error, item) => ({
      itemId: item.itemId,
      ok: false,
      response: null,
      error: statusMessageOf(error, 'Translation could not be saved')
    })
  )

  return { results }
})
