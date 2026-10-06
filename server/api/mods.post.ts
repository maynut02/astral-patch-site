import { setResponseHeader } from 'h3'
import { requireCurrentSessionUser } from '../utils/auth-user'
import { createMod, rethrowModRequestError } from '../utils/mod-hub'
import { readJsonBody } from '../utils/request-security'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  try {
    const user = await requireCurrentSessionUser(event)
    const body = await readJsonBody<Record<string, unknown>>(event)
    return await createMod(user.id, body)
  } catch (error) {
    rethrowModRequestError(error)
  }
})
