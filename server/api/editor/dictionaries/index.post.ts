import { readBody } from 'h3'
import { createEditorDictionary, getEditorDictionaryViewer } from '../../../utils/editor-dictionary'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody<{ name?: unknown, description?: unknown, visibility?: unknown }>(event)

  return createEditorDictionary(getEditorDictionaryViewer(session.user), body || {})
})
