import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../../../utils/auth-user'
import { getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../../../utils/editor-dictionary'
import { deleteEditorDictionaryEntry } from '../../../../../utils/editor-dictionary/entries'
import { assertMutationRequest } from '../../../../../utils/request-security'
import { parseUuid } from '../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  assertMutationRequest(event)
  const user = await requireCurrentSessionUser(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const entryId = parseUuid(getRouterParam(event, 'entryId'), 'Invalid entry id')
  await deleteEditorDictionaryEntry(getEditorDictionaryViewer(user), dictionaryId, entryId)

  return { id: entryId, deleted: true }
})
