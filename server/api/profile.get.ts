import { requireCurrentSessionUser } from '../utils/auth-user'
import { getUserProfileDetails } from '../utils/profile-details'

export default defineEventHandler(async (event) => {
  const currentUser = await requireCurrentSessionUser(event)
  const profile = await getUserProfileDetails(currentUser.id)

  return {
    handle: profile.handle,
    role: profile.role,
    gameUid: profile.gameUid,
    gameInviteCode: profile.gameInviteCode,
    socialLinks: profile.socialLinks
  }
})
