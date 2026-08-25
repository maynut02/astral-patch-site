import { getRouterParam } from 'h3'
import {
  deleteEditorDictionaryEntry,
  parseEditorDictionaryEntryId,
  parseEditorDictionaryId
} from '../../../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const entryId = parseEditorDictionaryEntryId(getRouterParam(event, 'entryId'))

  await deleteEditorDictionaryEntry({
    id: session.user.id,
    role: session.user.role
  }, dictionaryId, entryId)

  return { ok: true }
})
