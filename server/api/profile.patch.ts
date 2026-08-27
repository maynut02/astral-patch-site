import { requireCurrentSessionUser } from '../utils/auth-user'
import { readJsonBody } from '../utils/request-security'
import { saveUserProfileDetails, type UserProfileUpdateInput } from '../utils/profile-details'

export default defineEventHandler(async (event) => {
  const currentUser = await requireCurrentSessionUser(event)
  const body = await readJsonBody<UserProfileUpdateInput>(event)
  const session = await getUserSession(event)

  const user = await saveUserProfileDetails(currentUser.id, body)

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
    handle: user.handle,
    role: user.role,
    gameUid: user.gameUid,
    gameInviteCode: user.gameInviteCode,
    socialLinks: user.socialLinks
  }
})