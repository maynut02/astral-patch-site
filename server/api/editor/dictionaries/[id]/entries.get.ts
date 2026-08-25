import { getQuery, getRouterParam } from 'h3'
import { getCurrentSessionUser } from '../../../../utils/auth-user'
import {
  getEditorDictionaryEntries,
  getEditorDictionaryViewer,
  parseEditorDictionaryId
} from '../../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const user = await getCurrentSessionUser(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const query = getQuery(event)

  return getEditorDictionaryEntries(getEditorDictionaryViewer(user), dictionaryId, {
    page: query.page,
    search: query.search
  })
})
