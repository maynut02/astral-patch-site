import { getRouterParam } from 'h3'
import { getCurrentSessionUser } from '../../utils/auth-user'
import { getModDetail } from '../../utils/mod-hub'

export default defineEventHandler(async (event) => {
  const user = await getCurrentSessionUser(event)
  return getModDetail(getRouterParam(event, 'id'), user?.id ?? null)
})
