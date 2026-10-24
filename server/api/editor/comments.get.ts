import { getQuery } from 'h3'
import { getEditorComments } from '../../utils/editor-comments'

// 댓글 목록(전체 포함)은 의도적인 공개 읽기 API다.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  return getEditorComments({
    itemId: query.itemId,
    before: query.before
  })
})
