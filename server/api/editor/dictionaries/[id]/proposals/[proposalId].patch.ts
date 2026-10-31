import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../../../utils/auth-user'
import { getEditorDictionaryViewer, parseEditorDictionaryId } from '../../../../../utils/editor-dictionary'
import { decideGlossaryProposal } from '../../../../../utils/editor-dictionary/glossary'
import { parseUuid } from '../../../../../utils/validation'
import { readJsonBody } from '../../../../../utils/request-security'
import { assertEditorReviewRateLimit } from '../../../../../utils/editor-rate-limit'

export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event)
  const user = await requireCurrentSessionUser(event)
  await assertEditorReviewRateLimit(user.id)
  return decideGlossaryProposal(getEditorDictionaryViewer(user), parseEditorDictionaryId(getRouterParam(event, 'id')),
    parseUuid(getRouterParam(event, 'proposalId'), 'Invalid proposal id'), body)
})
