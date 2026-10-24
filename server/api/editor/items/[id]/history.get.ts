import { getRouterParam } from 'h3'
import { getEditorHistory, parseEditorUnitId } from '../../../../utils/editor-changes'

// 항목 이력은 전체를 공개하며 자르거나 페이지로 나누지 않는다.
export default defineEventHandler(async (event) => {
  const unitId = parseEditorUnitId(getRouterParam(event, 'id'))
  return getEditorHistory(unitId)
})
