import { getQuery } from 'h3'
import { getEditorTranslationLogs, parseEditorLogQuery } from '../../../utils/editor-log'

export default defineEventHandler(async (event) => {
  const filters = parseEditorLogQuery(getQuery(event))
  return getEditorTranslationLogs(filters)
})
