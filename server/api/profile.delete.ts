import { deleteUserAccount } from '../utils/user-account'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)

  await deleteUserAccount(session.user.id)
  await clearUserSession(event)

  return { success: true }
})
