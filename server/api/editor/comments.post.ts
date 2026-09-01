import { requireCurrentSessionUser } from '../../utils/auth-user'
import { createEditorComment } from '../../utils/editor-comments'
import { assertEditorCommentRateLimit } from '../../utils/editor-rate-limit'
import { readJsonBody } from '../../utils/request-security'
import { parseUuid } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  await assertEditorCommentRateLimit(user.id)
  const body = await readJsonBody<{ unitId?: unknown, body?: unknown }>(event)
  const unitId = parseUuid(body.unitId, 'Invalid comment item id')

  return createEditorComment(unitId, user.id, body.body)
})
