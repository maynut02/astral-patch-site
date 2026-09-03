import { createError } from 'h3'
import type { EditorReviewCandidatesResponse } from '#shared/types/editor'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { assertEditorReviewPermission, getPendingEditorReviewCandidates } from '../../../utils/editor-approval'
import { parseEditorUnitId } from '../../../utils/editor-changes'
import { readJsonBody } from '../../../utils/request-security'

const MAX_CANDIDATE_UNITS = 50

interface ReviewCandidatesInput {
  unitIds?: unknown
}

export default defineEventHandler(async (event): Promise<EditorReviewCandidatesResponse> => {
  const user = await requireCurrentSessionUser(event)
  assertEditorReviewPermission(user)

  const body = await readJsonBody<ReviewCandidatesInput>(event)
  if (!Array.isArray(body.unitIds) || body.unitIds.length === 0 || body.unitIds.length > MAX_CANDIDATE_UNITS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Request must contain between 1 and ${MAX_CANDIDATE_UNITS} unit ids`
    })
  }

  const unitIds = body.unitIds.map(parseEditorUnitId)
  if (new Set(unitIds).size !== unitIds.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Request contains duplicate unit ids'
    })
  }

  return getPendingEditorReviewCandidates(unitIds)
})
