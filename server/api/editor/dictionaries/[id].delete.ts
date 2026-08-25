import { getRouterParam } from 'h3'
import { deleteEditorDictionary, getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))

  await deleteEditorDictionary(getEditorDictionaryViewer(session.user), dictionaryId)

  return { ok: true }
})
