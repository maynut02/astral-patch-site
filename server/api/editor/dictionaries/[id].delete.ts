import { getRouterParam } from 'h3'
import { deleteEditorDictionary, parseEditorDictionaryId } from '../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))

  await deleteEditorDictionary({
    id: session.user.id,
    role: session.user.role
  }, dictionaryId)

  return { ok: true }
})
