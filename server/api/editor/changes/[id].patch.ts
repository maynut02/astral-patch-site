import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { assertEditorReviewPermission, parseEditorChangeId, reviewEditorChange } from '../../../utils/editor-approval'
import { assertEditorReviewRateLimit } from '../../../utils/editor-rate-limit'
import { readJsonBody } from '../../../utils/request-security'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  assertEditorReviewPermission(user)
  await assertEditorReviewRateLimit(user.id)
  const changeId = parseEditorChangeId(getRouterParam(event, 'id'))

  const body = await readJsonBody(event)

  return reviewEditorChange(changeId, user.id, body)
})
