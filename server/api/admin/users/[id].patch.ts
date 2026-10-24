import { createError, getRouterParam } from 'h3'
import { requireAdminSession } from '../../../utils/auth-user'
import { updateAdminUserRole } from '../../../utils/admin-users'
import { readJsonBody } from '../../../utils/request-security'

export default defineEventHandler(async (event) => {
  const admin = await requireAdminSession(event)
  const userId = getRouterParam(event, 'id')?.trim()

  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'User id is required' })
  }

  const body = await readJsonBody(event)
  return updateAdminUserRole(userId, admin.id, body.role)
})
