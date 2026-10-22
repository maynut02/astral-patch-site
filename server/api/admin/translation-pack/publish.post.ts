import { requireAdminSession } from '../../../utils/auth-user'
import { assertMutationRequest } from '../../../utils/request-security'
import { publishTranslationPack } from '../../../utils/translation-pack'

export default defineEventHandler(async (event) => {
  assertMutationRequest(event)
  const user = await requireAdminSession(event)
  return publishTranslationPack(user)
})
