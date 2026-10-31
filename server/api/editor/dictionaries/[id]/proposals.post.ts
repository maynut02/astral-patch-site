import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../../utils/auth-user'
import { getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../../utils/editor-dictionary'
import { proposeGlossaryEntry } from '../../../../utils/editor-dictionary/glossary'
import { readJsonBody } from '../../../../utils/request-security'
import { assertEditorMutationRateLimit } from '../../../../utils/editor-rate-limit'

export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event)
  const user = await requireCurrentSessionUser(event)
  await assertEditorMutationRateLimit(user.id)
  return proposeGlossaryEntry(getEditorDictionaryViewer(user), parseEditorDictionaryId(getRouterParam(event, 'id')), body)
})
