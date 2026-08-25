import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../../utils/auth-user'
import { assertEditorReviewPermission, parseEditorChangeId, reviewEditorChange } from '../../../utils/editor-approval'
import { readJsonBody } from '../../../utils/request-security'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  assertEditorReviewPermission(user)
  const changeId = parseEditorChangeId(getRouterParam(event, 'id'))

  const body = await readJsonBody<{ action?: unknown }>(event)

  return reviewEditorChange(changeId, user.id, body)
})
