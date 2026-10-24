import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { createEditorDictionary, getEditorDictionaryViewer } from '../../../utils/editor-dictionary'
import { readJsonBody } from '../../../utils/request-security'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  const body = await readJsonBody(event)

  return createEditorDictionary(getEditorDictionaryViewer(user), body)
})
