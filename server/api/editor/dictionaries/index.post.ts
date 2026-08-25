import { readBody } from 'h3'
import { createEditorDictionary } from '../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody<{ name?: unknown, description?: unknown, visibility?: unknown }>(event)

  return createEditorDictionary({
    id: session.user.id,
    role: session.user.role
  }, body || {})
})
