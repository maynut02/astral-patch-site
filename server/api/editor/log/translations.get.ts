import { getQuery } from 'h3'
import { getEditorTranslationLogs, parseEditorLogQuery } from '../../../utils/editor-log'

// 변경 로그는 번역 참여 여부와 관계없이 공개한다.
export default defineEventHandler(async (event) => {
  const filters = parseEditorLogQuery(getQuery(event))
  return getEditorTranslationLogs(filters)
})
