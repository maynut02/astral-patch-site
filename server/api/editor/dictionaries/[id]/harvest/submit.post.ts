import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../../../utils/auth-user'
import { getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../../../utils/editor-dictionary'
import { submitHarvest } from '../../../../../utils/editor-dictionary/harvest'
import { readJsonBody } from '../../../../../utils/request-security'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  return submitHarvest(getEditorDictionaryViewer(user), parseEditorDictionaryId(getRouterParam(event, 'id')), await readJsonBody(event))
})
