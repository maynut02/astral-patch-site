import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { createEditorDictionary, getEditorDictionaryViewer } from '../../../utils/editor-dictionary'
import { readJsonBody } from '../../../utils/request-security'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  const body = await readJsonBody<{ name?: unknown, description?: unknown, visibility?: unknown }>(event)

  return createEditorDictionary(getEditorDictionaryViewer(user), body)
})
