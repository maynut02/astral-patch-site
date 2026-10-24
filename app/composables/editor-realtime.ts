import type { EditorItem, EditorItemsResponse } from '#shared/types/editor'
import type { EditorOverviewResponse } from '#shared/types/editor-overview'
import type { AstralWebSocketMessage } from '#shared/types/websocket'
import type { ComputedRef } from 'vue'
import type { EditorPageData } from '~/utils/editor-page-state'
import type { useEditorQuery } from '~/composables/editor-query'
import type { useEditorItems } from '~/composables/editor-items'
import type { useEditorDraftStorage } from '~/composables/editor-drafts'

export function useEditorRealtime(data: EditorPageData, query: ReturnType<typeof useEditorQuery> & { requestQuery: ComputedRef<Record<string, string | number | undefined>> }, itemState: ReturnType<typeof useEditorItems>, draftStorage: ReturnType<typeof useEditorDraftStorage>) {
  const { itemsData, overviewData } = data
  const { requestQuery, viewFilter, search, searchType } = query
  const { items, selectedItemId, historyReloadKey, setPersistedItemState, capturePersistedStates } = itemState
  const { hasItemDraft } = draftStorage

  let editorRealtimeSyncTimer: ReturnType<typeof setTimeout> | undefined
  const pendingRealtimeItemIds = new Set<string>()

  const {
    onMessage: onWsMessage,
    onReconnect: onWsReconnect
  } = useAstralWebSocket({
    topics: ['editor']
  })

  async function fetchRealtimeEditorItems(itemIds: string[]): Promise<EditorItem[]> {
    const chunks: string[][] = []

    for (let index = 0; index < itemIds.length; index += 50) {
      chunks.push(itemIds.slice(index, index + 50))
    }

    const responses = await Promise.all(chunks.map(chunk => $fetch<EditorItemsResponse>('/api/editor/items', {
      query: {
        page: 1,
        itemIds: chunk.join(',')
      }
    })))

    return responses.flatMap(response => response.items)
  }

  function patchRealtimeEditorItem(serverItem: EditorItem): void {
    const visibleItem = items.value.find(item => item.id === serverItem.id)
    const keepDraftText = visibleItem && hasItemDraft(visibleItem)
      ? visibleItem.ko
      : null

    setPersistedItemState(serverItem.id, serverItem)

    if (!visibleItem) {
      return
    }

    Object.assign(visibleItem, serverItem)

    if (keepDraftText !== null) {
      visibleItem.ko = keepDraftText
    }
  }

  async function syncEditorOverviewSilently(): Promise<void> {
    overviewData.value = await $fetch<EditorOverviewResponse>('/api/editor/overview')
  }

  function realtimeChangeCanAffectListMembership(): boolean {
    const hasStatusFilter = viewFilter.value === 'untranslated'
      || viewFilter.value === 'pending'
      || viewFilter.value === 'warning'
    const searchesTranslation = Boolean(search.value)
      && (searchType.value === 'all'
        || searchType.value === 'content'
        || searchType.value === 'translation')

    return hasStatusFilter || searchesTranslation
  }

  async function syncEditorPageSilently(): Promise<void> {
    const draftTexts = new Map(
      items.value
        .filter(item => hasItemDraft(item))
        .map(item => [item.id, item.ko] as const)
    )
    const nextData = await $fetch<EditorItemsResponse>('/api/editor/items', {
      query: requestQuery.value
    })

    capturePersistedStates(nextData.items)
    for (const item of nextData.items) {
      const draftText = draftTexts.get(item.id)
      if (draftText !== undefined) item.ko = draftText
    }

    itemsData.value = nextData
  }

  async function syncRealtimeEditorItems(itemIds: string[]): Promise<void> {
    if (realtimeChangeCanAffectListMembership()) {
      await syncEditorPageSilently()
      return
    }

    const serverItems = await fetchRealtimeEditorItems(itemIds)

    for (const serverItem of serverItems) {
      patchRealtimeEditorItem(serverItem)
    }
  }

  function scheduleEditorRealtimeSync(message: AstralWebSocketMessage): void {
    if (typeof message.itemId !== 'string') {
      return
    }

    pendingRealtimeItemIds.add(message.itemId)

    if (editorRealtimeSyncTimer) {
      clearTimeout(editorRealtimeSyncTimer)
    }

    editorRealtimeSyncTimer = setTimeout(() => {
      editorRealtimeSyncTimer = undefined
      const itemIds = [...pendingRealtimeItemIds]

      if (selectedItemId.value && pendingRealtimeItemIds.has(selectedItemId.value)) {
        historyReloadKey.value += 1
      }

      pendingRealtimeItemIds.clear()
      void Promise.allSettled([
        syncRealtimeEditorItems(itemIds),
        syncEditorOverviewSilently()
      ])
    }, 300)
  }

  onWsMessage('EDITOR_ITEM_CHANGED', scheduleEditorRealtimeSync)
  onWsMessage('EDITOR_ITEM_REVIEWED', scheduleEditorRealtimeSync)
  onWsReconnect(() => {
    if (editorRealtimeSyncTimer) {
      clearTimeout(editorRealtimeSyncTimer)
      editorRealtimeSyncTimer = undefined
    }
    pendingRealtimeItemIds.clear()

    if (selectedItemId.value) {
      historyReloadKey.value += 1
    }

    void Promise.allSettled([
      syncEditorPageSilently(),
      syncEditorOverviewSilently()
    ])
  })

  onBeforeUnmount(() => {
    if (editorRealtimeSyncTimer) clearTimeout(editorRealtimeSyncTimer)
    pendingRealtimeItemIds.clear()
  })
}
