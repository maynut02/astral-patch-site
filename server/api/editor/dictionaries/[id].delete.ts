import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { deleteEditorDictionary, getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../utils/editor-dictionary'
import { assertMutationRequest } from '../../../utils/request-security'

export default defineEventHandler(async (event) => {
  assertMutationRequest(event)
  const user = await requireCurrentSessionUser(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))

  await deleteEditorDictionary(getEditorDictionaryViewer(user), dictionaryId)

  return { ok: true }
})
