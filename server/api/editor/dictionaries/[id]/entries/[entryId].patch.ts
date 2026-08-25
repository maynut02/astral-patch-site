import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../../../utils/auth-user'
import {
  parseEditorDictionaryEntryId,
  parseEditorDictionaryId,
  getEditorDictionaryViewer,
  updateEditorDictionaryEntry
} from '../../../../../utils/editor-dictionary'
import { readJsonBody } from '../../../../../utils/request-security'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const entryId = parseEditorDictionaryEntryId(getRouterParam(event, 'entryId'))
  const body = await readJsonBody<{ sourceText?: unknown, translation?: unknown, note?: unknown }>(event)

  return updateEditorDictionaryEntry(getEditorDictionaryViewer(user), dictionaryId, entryId, body)
})
