import { getRouterParam } from 'h3'
import { getCurrentSessionUser } from '../../../../../utils/auth-user'
import { getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../../../utils/editor-dictionary'
import { getEditorDictionaryEntry } from '../../../../../utils/editor-dictionary/entries'
import { parseUuid } from '../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await getCurrentSessionUser(event)
  return getEditorDictionaryEntry(getEditorDictionaryViewer(user), parseEditorDictionaryId(getRouterParam(event, 'id')),
    parseUuid(getRouterParam(event, 'entryId'), 'Invalid entry id'))
})
