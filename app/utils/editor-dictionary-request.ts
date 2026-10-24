import type { EditorItemsResponse } from '#shared/types/editor'

interface DictionaryItemsResult {
  requestId: number
  response?: EditorItemsResponse
  error?: unknown
}

// 검색과 참조 조회는 서로 취소하지 않도록 각자 요청 순서를 갖는다.
export function createEditorDictionaryItemsRequest() {
  let requestId = 0

  function invalidate(): void {
    requestId += 1
  }

  async function fetchItems(query: Record<string, string | number>): Promise<DictionaryItemsResult> {
    const currentId = ++requestId
    try {
      const response = await $fetch<EditorItemsResponse>('/api/editor/items', { query })
      return { requestId: currentId, response }
    } catch (error) {
      return { requestId: currentId, error }
    }
  }

  function isCurrent(result: DictionaryItemsResult): boolean {
    return result.requestId === requestId
  }

  return { invalidate, fetchItems, isCurrent }
}
