import { requireCurrentSessionUser, updateUserProfile } from '../utils/auth-user'
import { readJsonBody } from '../utils/request-security'

export default defineEventHandler(async (event) => {
  const currentUser = await requireCurrentSessionUser(event)
  const body = await readJsonBody<{ handle?: unknown }>(event)
  const session = await getUserSession(event)

  const user = await updateUserProfile(currentUser.id, body)

  await setUserSession(event, {
    ...session,
    user: {
      id: user.googleSub,
      email: user.email,
      handle: user.handle,
      role: user.role
    }
  })

  return {
    handle: user.handle
  }
})
