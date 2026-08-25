import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { parseEditorUnitId, saveEditorTranslation } from '../../../utils/editor-changes'
import { readJsonBody } from '../../../utils/request-security'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  const unitId = parseEditorUnitId(getRouterParam(event, 'id'))
  const body = await readJsonBody<{ text?: unknown }>(event)

  return saveEditorTranslation(unitId, user.id, body)
})
