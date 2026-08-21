import { getRouterParam, readBody } from 'h3'
import { requireAdminSession } from '../../../utils/auth-user'
import { parseEditorChangeId, reviewEditorChange } from '../../../utils/editor-approval'

export default defineEventHandler(async (event) => {
  const session = await requireAdminSession(event)
  const changeId = parseEditorChangeId(getRouterParam(event, 'id'))

  const body = await readBody<{ action?: unknown }>(event)

  return reviewEditorChange(changeId, session.user.id, body || {})
})
