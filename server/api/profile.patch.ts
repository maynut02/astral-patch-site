import { requireCurrentSessionUser, syncSessionUser } from '../utils/auth-user'
import { readJsonBody } from '../utils/request-security'
import { saveUserProfileDetails } from '../utils/profile-details'

export default defineEventHandler(async (event) => {
  const currentUser = await requireCurrentSessionUser(event)
  const body = await readJsonBody(event)

  const user = await saveUserProfileDetails(currentUser.id, body)

  await syncSessionUser(event, user)

  return {
    handle: user.handle,
    role: user.role,
    gameUid: user.gameUid,
    gameInviteCode: user.gameInviteCode,
    socialLinks: user.socialLinks
  }
})
