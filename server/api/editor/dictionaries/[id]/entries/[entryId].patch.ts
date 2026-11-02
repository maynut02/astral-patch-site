import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../../../utils/auth-user'
import { getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../../../utils/editor-dictionary'
import { updateEditorDictionaryEntry } from '../../../../../utils/editor-dictionary/entries'
import { readJsonBody } from '../../../../../utils/request-security'
import { parseUuid } from '../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const entryId = parseUuid(getRouterParam(event, 'entryId'), 'Invalid entry id')
  const body = await readJsonBody(event)

  return updateEditorDictionaryEntry(getEditorDictionaryViewer(user), dictionaryId, entryId, body)
})
