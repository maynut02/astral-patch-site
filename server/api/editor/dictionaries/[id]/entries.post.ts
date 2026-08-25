import { getRouterParam, readBody } from 'h3'
import { createEditorDictionaryEntry, parseEditorDictionaryId } from '../../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const body = await readBody<{ sourceText?: unknown, translation?: unknown, note?: unknown }>(event)

  return createEditorDictionaryEntry({
    id: session.user.id,
    role: session.user.role
  }, dictionaryId, body || {})
})
