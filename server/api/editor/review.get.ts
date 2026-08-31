import { getQuery } from 'h3'
import { requireCurrentSessionUser } from '../../utils/auth-user'
import { assertEditorReviewPermission } from '../../utils/editor-approval'
import { getEditorTranslationLogs, parseEditorLogQuery } from '../../utils/editor-log'

export default defineEventHandler(async (event) => {
  const user = await requireCurrentSessionUser(event)
  assertEditorReviewPermission(user)

  const filters = parseEditorLogQuery({
    ...getQuery(event),
    status: 'pending'
  })

  return getEditorTranslationLogs(filters)
})
