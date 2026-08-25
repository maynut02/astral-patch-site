import { getRouterParam, readBody } from 'h3'
import {
  parseEditorDictionaryEntryId,
  parseEditorDictionaryId,
  getEditorDictionaryViewer,
  updateEditorDictionaryEntry
} from '../../../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const entryId = parseEditorDictionaryEntryId(getRouterParam(event, 'entryId'))
  const body = await readBody<{ sourceText?: unknown, translation?: unknown, note?: unknown }>(event)

  return updateEditorDictionaryEntry(getEditorDictionaryViewer(session.user), dictionaryId, entryId, body || {})
})
