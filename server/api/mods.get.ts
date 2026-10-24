import { getCurrentSessionUser } from '../utils/auth-user'
import { getMods } from '../utils/mod-hub'

export default defineEventHandler(async (event) => {
  const user = await getCurrentSessionUser(event)
  return getMods(user?.id ?? null)
})
