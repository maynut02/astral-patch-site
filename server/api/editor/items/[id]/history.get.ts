import { getRouterParam } from 'h3'
import { getEditorHistory, parseEditorUnitId } from '../../../../utils/editor-changes'

export default defineEventHandler(async (event) => {
  const unitId = parseEditorUnitId(getRouterParam(event, 'id'))
  return getEditorHistory(unitId)
})
