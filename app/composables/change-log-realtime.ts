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
}

export function useChangeLogRealtime(options: ChangeLogRealtimeOptions) {
  const { translationData, translationSummaryData, overviewData, translationStatus, translationQuery, translationSearch, translationStatusFilter, translationPage, defaultTranslationData } = options
  const LOG_PAGE_SIZE = 50
  let translationRealtimeSyncTimer: ReturnType<typeof setTimeout> | undefined
  const pendingNewTranslationChangeIds = new Set<string>()
  const pendingUpdatedTranslationChangeIds = new Set<string>()

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
    const version = ++syncVersion
    const response = await $fetch<EditorTranslationLogResponse>('/api/editor/log/translations', {
      query: translationQuery.value
    })

    if (version === syncVersion) {
      translationData.value = response
    }
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

    const allChangeIds = [...new Set([...newChangeIds, ...updatedChangeIds])]
    const [entries, summaryResult] = await Promise.all([
      fetchRealtimeTranslationEntries(allChangeIds),
      syncTranslationAggregatesSilently()
    ])

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
      const newChangeIds = [...pendingNewTranslationChangeIds]
      const updatedChangeIds = [...pendingUpdatedTranslationChangeIds]
      pendingNewTranslationChangeIds.clear()
      pendingUpdatedTranslationChangeIds.clear()

      void Promise.allSettled([
        syncRealtimeTranslationChanges(newChangeIds, updatedChangeIds)
      ])
    }, 200)
  }

  onWsMessage('EDITOR_ITEM_CHANGED', scheduleTranslationRealtimeSync)
  onWsMessage('EDITOR_ITEM_REVIEWED', scheduleTranslationRealtimeSync)
  onWsReconnect(() => {
    if (translationRealtimeSyncTimer) {
      clearTimeout(translationRealtimeSyncTimer)
      translationRealtimeSyncTimer = undefined
    }
    pendingNewTranslationChangeIds.clear()
    pendingUpdatedTranslationChangeIds.clear()

    void Promise.allSettled([
      syncTranslationPageSilently(),
      syncTranslationAggregatesSilently()
    ])
  })

  onBeforeUnmount(() => {
    syncVersion += 1
    clearTimeout(translationRealtimeSyncTimer)
    pendingNewTranslationChangeIds.clear()
    pendingUpdatedTranslationChangeIds.clear()
  })
}
