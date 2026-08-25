import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../../../utils/auth-user'
import {
  deleteEditorDictionaryEntry,
  getEditorDictionaryViewer,
  parseEditorDictionaryEntryId,
  parseEditorDictionaryId
} from '../../../../../utils/editor-dictionary'
import { assertMutationRequest } from '../../../../../utils/request-security'

export default defineEventHandler(async (event) => {
  assertMutationRequest(event)
  const user = await requireCurrentSessionUser(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const entryId = parseEditorDictionaryEntryId(getRouterParam(event, 'entryId'))

  await deleteEditorDictionaryEntry(getEditorDictionaryViewer(user), dictionaryId, entryId)

  return { ok: true }
})
