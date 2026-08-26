import { createError, getRouterParam } from 'h3'
import { generateEditorAiTranslation } from '../../../../utils/ai-translation'
import { requireCurrentSessionUser } from '../../../../utils/auth-user'
import { getDatabase } from '../../../../utils/database'
import { parseEditorUnitId } from '../../../../utils/editor-changes'
import { isRateLimited } from '../../../../utils/rate-limiter'
import { readJsonBody } from '../../../../utils/request-security'
import { parseUuid } from '../../../../utils/validation'

const AI_RATE_LIMITS = [
  { name: 'minute', limit: 10, windowMs: 60_000 },
  { name: 'hour', limit: 100, windowMs: 3_600_000 }
] as const

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  const itemId = parseEditorUnitId(getRouterParam(event, 'id'))
  const body = await readJsonBody<{ sourceVersionId?: unknown }>(event)
  const sourceVersionId = parseUuid(body.sourceVersionId, 'Invalid source version id')

  if (user.role !== 'admin' && await isRateLimited(
    getDatabase(),
    `editor-ai-translation:${user.id}`,
    AI_RATE_LIMITS
  )) {
    throw createError({
      statusCode: 429,
      statusMessage: 'AI 번역 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    })
  }

  return generateEditorAiTranslation(itemId, sourceVersionId)
})
