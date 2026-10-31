import { getRouterParam, getQuery } from 'h3'
import { requireCurrentSessionUser } from '../../../../../utils/auth-user'
import { getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../../../utils/editor-dictionary'
import { exportHarvestSources } from '../../../../../utils/editor-dictionary/harvest'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  return exportHarvestSources(getEditorDictionaryViewer(user), parseEditorDictionaryId(getRouterParam(event, 'id')), getQuery(event))
})
