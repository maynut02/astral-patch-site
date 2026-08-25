import { requireCurrentSessionUser } from '../utils/auth-user'
import { assertMutationRequest } from '../utils/request-security'
import { deleteUserAccount } from '../utils/user-account'

export default defineEventHandler(async (event) => {
  assertMutationRequest(event)
  const user = await requireCurrentSessionUser(event)

  await deleteUserAccount(user.id)
  await clearUserSession(event)

  return { success: true }
})
