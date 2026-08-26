import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../../utils/auth-user'
import { parseEditorUnitId, retainEditorTranslation } from '../../../../utils/editor-changes'
import { assertEditorMutationRateLimit } from '../../../../utils/editor-rate-limit'
import { assertMutationRequest } from '../../../../utils/request-security'

export default defineEventHandler(async (event) => {
  assertMutationRequest(event)
  const user = await requireCurrentSessionUser(event)
  await assertEditorMutationRateLimit(user.id)
  const unitId = parseEditorUnitId(getRouterParam(event, 'id'))

  return retainEditorTranslation(unitId, user.id)
})
