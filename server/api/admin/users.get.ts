import { requireAdminSession } from '../../utils/auth-user'
import { getAdminUsers } from '../../utils/admin-users'

export default defineEventHandler(async (event) => {
  await requireAdminSession(event)
  return getAdminUsers()
})
