import { requireAdminSession } from '../../utils/auth-user'
import { getTranslationPackStatus } from '../../utils/translation-pack'

export default defineEventHandler(async (event) => {
  await requireAdminSession(event)
  return getTranslationPackStatus()
})
