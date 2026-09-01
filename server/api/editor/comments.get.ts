import { getQuery } from 'h3'
import { getEditorComments } from '../../utils/editor-comments'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  return getEditorComments({
    itemId: query.itemId,
    before: query.before
  })
})
