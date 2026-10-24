import { getQuery } from 'h3'
import { getEditorItems } from '../../utils/editor/items-query'
import { parseEditorQuery } from '../../utils/editor/filters'

// 에디터 읽기 API는 의도적으로 공개하며 실시간 갱신을 위해 캐시하지 않는다.
export default defineEventHandler(async (event) => {
  const filters = parseEditorQuery(getQuery(event))
  return getEditorItems(filters)
})
