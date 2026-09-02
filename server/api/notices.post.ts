import { requireAdminSession } from '../utils/auth-user'
import { createNotice } from '../utils/notices'
import { readJsonBody } from '../utils/request-security'

export default defineEventHandler(async (event) => {
  const user = await requireAdminSession(event)
  const body = await readJsonBody<{ title?: unknown, body?: unknown }>(event)

  return createNotice(user.id, body.title, body.body)
})
