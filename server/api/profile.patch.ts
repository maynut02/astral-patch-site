import { readBody } from 'h3'
import { updateUserProfile } from '../utils/auth-user'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody<{ handle?: unknown, nickname?: unknown }>(event)

  const user = await updateUserProfile(session.user.id, body || {})

  await setUserSession(event, {
    user: {
      ...session.user,
      handle: user.handle,
      nickname: user.nickname
    }
  })

  return {
    handle: user.handle,
    nickname: user.nickname
  }
})
