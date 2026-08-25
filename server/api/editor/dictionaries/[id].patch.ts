import { getRouterParam, readBody } from 'h3'
import { parseEditorDictionaryId, updateEditorDictionary } from '../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const body = await readBody<{ name?: unknown, description?: unknown, visibility?: unknown }>(event)

  return updateEditorDictionary({
    id: session.user.id,
    role: session.user.role
  }, dictionaryId, body || {})
})
