import { requireCurrentSessionUser } from '../utils/auth-user'
import { createMod, rethrowModRequestError } from '../utils/mod-hub'
import { readJsonBody } from '../utils/request-security'

export default defineEventHandler(async (event) => {
  try {
    const user = await requireCurrentSessionUser(event)
    const body = await readJsonBody(event)
    return await createMod(user.id, body)
  } catch (error) {
    rethrowModRequestError(error)
  }
})
