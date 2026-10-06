import { setResponseHeader } from 'h3'
import { getCurrentSessionUser } from '../utils/auth-user'
import { getMods } from '../utils/mod-hub'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const user = await getCurrentSessionUser(event)
  return getMods(user?.id ?? null)
})
