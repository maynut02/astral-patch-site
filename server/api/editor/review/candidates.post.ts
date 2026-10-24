import type { EditorReviewCandidatesResponse } from '#shared/types/editor'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { assertEditorReviewPermission, getPendingEditorReviewCandidates } from '../../../utils/editor-approval'
import { parseEditorUnitId } from '../../../utils/editor-changes'
import { readJsonBody } from '../../../utils/request-security'
import { assertUniqueBatch, requireBatchItems } from '../../../utils/batch'

const MAX_CANDIDATE_UNITS = 50

export default defineEventHandler(async (event): Promise<EditorReviewCandidatesResponse> => {
  const user = await requireCurrentSessionUser(event)
  assertEditorReviewPermission(user)

  const body = await readJsonBody(event)
  const rawIds = requireBatchItems(body.unitIds, MAX_CANDIDATE_UNITS, `Request must contain between 1 and ${MAX_CANDIDATE_UNITS} unit ids`)
  const unitIds = rawIds.map(parseEditorUnitId)
  assertUniqueBatch(unitIds, 'Request contains duplicate unit ids')

  return getPendingEditorReviewCandidates(unitIds)
})
