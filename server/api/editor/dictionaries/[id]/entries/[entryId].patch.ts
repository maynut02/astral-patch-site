import { getRouterParam, readBody } from 'h3'
import {
  parseEditorDictionaryEntryId,
  parseEditorDictionaryId,
  updateEditorDictionaryEntry
} from '../../../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const entryId = parseEditorDictionaryEntryId(getRouterParam(event, 'entryId'))
  const body = await readBody<{ sourceText?: unknown, translation?: unknown, note?: unknown }>(event)

  return updateEditorDictionaryEntry({
    id: session.user.id,
    role: session.user.role
  }, dictionaryId, entryId, body || {})
})
