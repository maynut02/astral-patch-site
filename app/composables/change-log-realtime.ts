import type { Ref, ComputedRef } from 'vue'
import type { EditorOverviewResponse } from '#shared/types/editor-overview'
import type { EditorTranslationLogEntry, EditorTranslationLogResponse, EditorTranslationLogSummary } from '#shared/types/editor'
import type { AstralWebSocketMessage } from '#shared/types/websocket'
import { ALL_STATUS_VALUE } from '~/composables/change-log-display'

interface ChangeLogRealtimeOptions {
  translationData: Ref<EditorTranslationLogResponse | null>
  translationSummaryData: Ref<EditorTranslationLogSummary | null>
  overviewData: Ref<EditorOverviewResponse | null>
  translationStatus: Ref<string>
  translationQuery: ComputedRef<{ page: number, search: string | undefined, status: string | undefined }>
  translationSearch: Ref<string>
  translationStatusFilter: Ref<string>
  translationPage: Ref<number>
  defaultTranslationData: EditorTranslationLogResponse
  refreshTranslations: () => Promise<unknown>
}

export function useChangeLogRealtime(options: ChangeLogRealtimeOptions) {
  const { translationData, translationSummaryData, overviewData, translationStatus, translationQuery, translationSearch, translationStatusFilter, translationPage, defaultTranslationData, refreshTranslations } = options
  const LOG_PAGE_SIZE = 50
  let translationRealtimeSyncTimer: ReturnType<typeof setTimeout> | undefined
  const pendingNewTranslationChangeIds = new Set<string>()
  const pendingUpdatedTranslationChangeIds = new Set<string>()
  let syncing = false
  let fullRefreshRequired = false
  let disposed = false

  const {
    onMessage: onWsMessage,
    onReconnect: onWsReconnect
  } = useAstralWebSocket({
    topics: ['change:translation']
  })

  function getTranslationLogTotal(summary: EditorTranslationLogSummary): number {
    return summary.pending + summary.approved + summary.rejected + summary.superseded
  }

  function sortTranslationEntries(entries: EditorTranslationLogEntry[]): EditorTranslationLogEntry[] {
    return [...entries].sort((left, right) => {
      const timeDifference = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      return timeDifference || right.id.localeCompare(left.id)
    })
  }

  async function fetchRealtimeTranslationEntries(changeIds: string[]): Promise<EditorTranslationLogEntry[]> {
    const responses = await Promise.allSettled(changeIds.map(changeId =>
      $fetch<EditorTranslationLogEntry>(`/api/editor/log/translations/${encodeURIComponent(changeId)}`)
    ))

    return responses.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  }

  let aggregateVersion = 0

  async function syncTranslationAggregatesSilently(): Promise<EditorTranslationLogSummary> {
    const version = ++aggregateVersion
    const [summary, nextOverview] = await Promise.all([
      $fetch<EditorTranslationLogSummary>('/api/editor/log/summary'),
      $fetch<EditorOverviewResponse>('/api/editor/overview')
    ])

    // 겹친 갱신 중 늦게 도착한 이전 응답이 최신 집계를 덮지 않게 한다.
    if (version !== aggregateVersion) {
      return translationSummaryData.value ?? summary
    }

    translationSummaryData.value = summary
    overviewData.value = nextOverview
    return summary
  }

  let syncVersion = 0

  watch(translationQuery, () => {
    syncVersion += 1
  }, { flush: 'sync' })

  async function syncTranslationPageSilently(): Promise<void> {
    syncVersion += 1
    // useFetch owns this ref; its refresh cancels older initial/query/manual requests.
    await refreshTranslations()
  }

  async function syncRealtimeTranslationChanges(
    newChangeIds: string[],
    updatedChangeIds: string[]
  ): Promise<void> {
    if (translationStatus.value !== 'success') {
      return
    }

    const hasListFilter = Boolean(translationSearch.value)
      || translationStatusFilter.value !== ALL_STATUS_VALUE
    const newChangesShiftCurrentPage = newChangeIds.length > 0 && translationPage.value > 1

    if (hasListFilter || newChangesShiftCurrentPage) {
      await Promise.all([
        syncTranslationPageSilently(),
        syncTranslationAggregatesSilently()
      ])
      return
    }

    const version = ++syncVersion
    const allChangeIds = [...new Set([...newChangeIds, ...updatedChangeIds])]
    const [entries, summaryResult] = await Promise.all([
      fetchRealtimeTranslationEntries(allChangeIds),
      syncTranslationAggregatesSilently()
    ])

    if (version !== syncVersion) {
      return
    }

    const current = translationData.value ?? defaultTranslationData
    const entriesById = new Map(entries.map(entry => [entry.id, entry]))
    const currentIds = new Set(current.entries.map(entry => entry.id))
    const patchedEntries = current.entries.map(entry => entriesById.get(entry.id) ?? entry)

    if (translationPage.value === 1) {
      for (const changeId of newChangeIds) {
        const entry = entriesById.get(changeId)
        if (entry && !currentIds.has(changeId)) {
          patchedEntries.push(entry)
        }
      }
    }

    const total = getTranslationLogTotal(summaryResult)
    translationData.value = {
      ...current,
      entries: sortTranslationEntries(patchedEntries).slice(0, current.pageSize || LOG_PAGE_SIZE),
      total,
      totalPages: Math.max(1, Math.ceil(total / (current.pageSize || LOG_PAGE_SIZE)))
    }
  }

  async function drainTranslationSync(): Promise<void> {
    if (syncing || disposed) return
    syncing = true
    try {
      while (!disposed && (fullRefreshRequired || pendingNewTranslationChangeIds.size || pendingUpdatedTranslationChangeIds.size)) {
        const fullRefresh = fullRefreshRequired
        fullRefreshRequired = false
        const newChangeIds = [...pendingNewTranslationChangeIds]
        const updatedChangeIds = [...pendingUpdatedTranslationChangeIds]
        pendingNewTranslationChangeIds.clear()
        pendingUpdatedTranslationChangeIds.clear()
        if (fullRefresh) {
          await Promise.allSettled([
            syncTranslationPageSilently(),
            syncTranslationAggregatesSilently()
          ])
        } else {
          await Promise.allSettled([syncRealtimeTranslationChanges(newChangeIds, updatedChangeIds)])
        }
      }
    } finally {
      syncing = false
    }
  }

  function requestFullRefresh(): void {
    syncVersion += 1
    fullRefreshRequired = true
    clearTimeout(translationRealtimeSyncTimer)
    translationRealtimeSyncTimer = undefined
    void drainTranslationSync()
  }

  function scheduleTranslationRealtimeSync(message: AstralWebSocketMessage): void {
    if (message.type === 'EDITOR_ITEM_CHANGED') {
      if (typeof message.changeId !== 'string') {
        return
      }
      pendingNewTranslationChangeIds.add(message.changeId)
    } else if (message.type === 'EDITOR_ITEM_REVIEWED') {
      if (typeof message.changeId !== 'string') {
        return
      }

      pendingUpdatedTranslationChangeIds.add(message.changeId)

      if (Array.isArray(message.supersededChangeIds)) {
        for (const changeId of message.supersededChangeIds) {
          if (typeof changeId === 'string') {
            pendingUpdatedTranslationChangeIds.add(changeId)
          }
        }
      }
    } else {
      return
    }

    clearTimeout(translationRealtimeSyncTimer)

    translationRealtimeSyncTimer = setTimeout(() => {
      translationRealtimeSyncTimer = undefined
      void drainTranslationSync()
    }, 200)
  }

  onWsMessage('EDITOR_ITEM_CHANGED', scheduleTranslationRealtimeSync)
  onWsMessage('EDITOR_ITEM_REVIEWED', scheduleTranslationRealtimeSync)
  onWsMessage('TRANSLATION_PACK_PUBLISHED', requestFullRefresh)
  onWsReconnect(requestFullRefresh)

  onBeforeUnmount(() => {
    disposed = true
    syncVersion += 1
    clearTimeout(translationRealtimeSyncTimer)
    pendingNewTranslationChangeIds.clear()
    pendingUpdatedTranslationChangeIds.clear()
  })
}
