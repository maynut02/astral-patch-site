import { createError, getRouterParam } from 'h3'
import { getEditorTranslationLogEntry } from '../../../../utils/editor-log'
import { parseUuid } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const changeId = parseUuid(getRouterParam(event, 'id'), 'Invalid translation change id')
  const entry = await getEditorTranslationLogEntry(changeId)

  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Translation change could not be found'
    })
  }

  return entry
})
