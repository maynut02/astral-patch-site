import { getRouterParam } from 'h3'
import { requireCurrentSessionUser } from '../../utils/auth-user'
import { deleteMod, rethrowModRequestError } from '../../utils/mod-hub'
import { assertMutationRequest } from '../../utils/request-security'

export default defineEventHandler(async (event) => {
  try {
    const user = await requireCurrentSessionUser(event)
    assertMutationRequest(event)
    return await deleteMod(user.id, getRouterParam(event, 'id'))
  } catch (error) {
    rethrowModRequestError(error)
  }
})
