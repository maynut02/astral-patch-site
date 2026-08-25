import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { getEditorDictionaryViewer, parseEditorDictionaryId, updateEditorDictionary } from '../../../utils/editor-dictionary'
import { readJsonBody } from '../../../utils/request-security'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const body = await readJsonBody<{ name?: unknown, description?: unknown, visibility?: unknown }>(event)

  return updateEditorDictionary(getEditorDictionaryViewer(user), dictionaryId, body)
})
