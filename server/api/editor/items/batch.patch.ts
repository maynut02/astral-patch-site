import { createError } from 'h3'
import type { EditorBatchSaveResponse } from '#shared/types/editor'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { parseEditorUnitId, saveEditorTranslation } from '../../../utils/editor-changes'
import { assertEditorMutationRateLimit } from '../../../utils/editor-rate-limit'
import { readJsonBody } from '../../../utils/request-security'

const MAX_BATCH_ITEMS = 50

interface BatchSaveItemInput {
  id?: unknown
  text?: unknown
}

function getSaveErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Translation could not be saved'
  }

  const value = error as { statusMessage?: unknown, message?: unknown }

  if (typeof value.statusMessage === 'string' && value.statusMessage.trim()) {
    return value.statusMessage
  }

  if (typeof value.message === 'string' && value.message.trim()) {
    return value.message
  }

  return 'Translation could not be saved'
}

export default defineEventHandler(async (event): Promise<EditorBatchSaveResponse> => {
  const user = await requireCurrentSessionUser(event)
  const body = await readJsonBody<{ items?: unknown }>(event)

  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_BATCH_ITEMS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Batch must contain between 1 and ${MAX_BATCH_ITEMS} items`
    })
  }

  await assertEditorMutationRateLimit(user.id, body.items.length)

  const items = body.items.map((raw): { itemId: string, text: unknown } => {
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

  if (new Set(items.map(item => item.itemId)).size !== items.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Batch contains duplicate item ids'
    })
  }

  const results: EditorBatchSaveResponse['results'] = []

  // Process sequentially to keep database pressure predictable. Each item keeps its own
  // transaction so a stale source or validation error does not roll back unrelated edits.
  for (const item of items) {
    try {
      const response = await saveEditorTranslation(item.itemId, user.id, { text: item.text })
      results.push({
        itemId: item.itemId,
        ok: true,
        response,
        error: null
      })
    } catch (error: unknown) {
      results.push({
        itemId: item.itemId,
        ok: false,
        response: null,
        error: getSaveErrorMessage(error)
      })
    }
  }

  return { results }
})
