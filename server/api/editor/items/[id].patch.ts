import { getRouterParam, readBody } from 'h3'
import { parseEditorUnitId, saveEditorTranslation } from '../../../utils/editor-changes'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const unitId = parseEditorUnitId(getRouterParam(event, 'id'))
  const body = await readBody<{ text?: unknown, expectedText?: unknown }>(event)

  return saveEditorTranslation(unitId, session.user.id, body || {})
})
