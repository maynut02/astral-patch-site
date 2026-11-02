import { getQuery, getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../../utils/auth-user'
import { getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../../utils/editor-dictionary'
import { getGlossaryProposals } from '../../../../utils/editor-dictionary/glossary'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  return getGlossaryProposals(getEditorDictionaryViewer(user), parseEditorDictionaryId(getRouterParam(event, 'id')), getQuery(event))
})
