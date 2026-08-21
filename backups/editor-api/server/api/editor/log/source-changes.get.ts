import { getQuery } from 'h3'
import {
  getEditorSourceChanges,
  parseEditorLogQuery,
  parseEditorLogRevisionId
} from '../../../utils/editor-log'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const revisionId = parseEditorLogRevisionId(query.revisionId)
  const { page } = parseEditorLogQuery(query)

  return getEditorSourceChanges(revisionId, page)
})
