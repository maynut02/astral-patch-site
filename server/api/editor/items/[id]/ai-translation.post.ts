import { getRouterParam } from 'h3'
import { generateEditorAiTranslation } from '../../../../utils/ai-translation'
import { requireCurrentSessionUser } from '../../../../utils/auth-user'
import { parseEditorUnitId } from '../../../../utils/editor-changes'
import { assertEditorAiTranslationRateLimit } from '../../../../utils/editor-rate-limit'
import { readJsonBody } from '../../../../utils/request-security'
import { parseUuid } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  const itemId = parseEditorUnitId(getRouterParam(event, 'id'))
  const body = await readJsonBody(event)
  const sourceVersionId = parseUuid(body.sourceVersionId, 'Invalid source version id')

  await assertEditorAiTranslationRateLimit(user)

  return generateEditorAiTranslation(itemId, sourceVersionId)
})
