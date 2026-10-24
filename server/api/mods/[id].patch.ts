import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../utils/auth-user'
import { rethrowModRequestError, updateMod } from '../../utils/mod-hub'
import { readJsonBody } from '../../utils/request-security'

export default defineEventHandler(async (event) => {
  try {
    const user = await requireCurrentSessionUser(event)
    const body = await readJsonBody(event)
    return await updateMod(user.id, getRouterParam(event, 'id'), body)
  } catch (error) {
    rethrowModRequestError(error)
  }
})
