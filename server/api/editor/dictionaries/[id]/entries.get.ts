import { getQuery, getRouterParam } from 'h3'
import { getCurrentSessionUser } from '../../../../utils/auth-user'
import {
  getEditorDictionaryViewer,
  parseEditorDictionaryId
} from '../../../../utils/editor-dictionary'
import { getEditorDictionaryEntries } from '../../../../utils/editor-dictionary/entries'

export default defineEventHandler(async (event) => {
  const user = await getCurrentSessionUser(event)
  const dictionaryId = parseEditorDictionaryId(getRouterParam(event, 'id'))
  const query = getQuery(event)

  return getEditorDictionaryEntries(getEditorDictionaryViewer(user), dictionaryId, {
    page: query.page,
    search: query.search,
    kind: query.kind,
    archived: query.archived
  })
})
