import { getQuery } from 'h3'
import { getEditorItems, parseEditorQuery } from '../../utils/editor-query'

export default defineEventHandler(async (event) => {
  const filters = parseEditorQuery(getQuery(event))
  return getEditorItems(filters)
})
