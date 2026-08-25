import { getCurrentSessionUser } from '../../../utils/auth-user'
import { getEditorDictionaries, getEditorDictionaryViewer } from '../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const user = await getCurrentSessionUser(event)

  return getEditorDictionaries(getEditorDictionaryViewer(user))
})
