import { getEditorDictionaries, getEditorDictionaryViewer } from '../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)

  return getEditorDictionaries(getEditorDictionaryViewer(session.user))
})
