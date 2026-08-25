import { getQuery, getRouterParam } from 'h3'
import {
  getEditorDictionaryEntries,
  getEditorDictionaryViewer,
  parseEditorDictionaryId
} from '../../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const query = getQuery(event)

  return getEditorDictionaryEntries(getEditorDictionaryViewer(session.user), dictionaryId, {
    page: query.page,
    search: query.search
  })
})
