import { getRouterParam, setResponseHeader } from 'h3'
import { requireCurrentSessionUser } from '../../utils/auth-user'
import { rethrowModRequestError, updateMod } from '../../utils/mod-hub'
import { readJsonBody } from '../../utils/request-security'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  try {
    const user = await requireCurrentSessionUser(event)
    const body = await readJsonBody<Record<string, unknown>>(event)
    return await updateMod(user.id, getRouterParam(event, 'id'), body)
  } catch (error) {
    rethrowModRequestError(error)
  }
})
