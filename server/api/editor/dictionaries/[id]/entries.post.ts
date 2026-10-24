import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../../utils/auth-user'
import { getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../../utils/editor-dictionary'
import { createEditorDictionaryEntry } from '../../../../utils/editor-dictionary/entries'
import { readJsonBody } from '../../../../utils/request-security'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const body = await readJsonBody(event)

  return createEditorDictionaryEntry(getEditorDictionaryViewer(user), dictionaryId, body)
})
