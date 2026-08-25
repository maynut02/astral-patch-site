import { getRouterParam, readBody } from 'h3'
import { assertEditorReviewPermission, parseEditorChangeId, reviewEditorChange } from '../../../utils/editor-approval'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  assertEditorReviewPermission(session.user)
  const changeId = parseEditorChangeId(getRouterParam(event, 'id'))

  const body = await readBody<{ action?: unknown }>(event)

  return reviewEditorChange(changeId, session.user.id, body || {})
})
