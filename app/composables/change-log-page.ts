import type { EditorSourceChangesResponse, EditorSourceRevision, EditorSourceRevisionsResponse, EditorTranslationLogResponse, EditorTranslationLogSummary } from '#shared/types/editor'
import type { EditorOverviewResponse } from '#shared/types/editor-overview'
import { EDITOR_DIFF_MODE_OPTIONS, isEditorDiffMode } from '~/utils/editor-options'
import { getEditorQueryString, normalizeEditorRevision, normalizeEditorVersion } from '~/utils/editor-helpers'
import { createEmptyEditorOverview } from '~/utils/editor-progress'
import { ALL_STATUS_VALUE, statusItems } from '~/composables/change-log-display'
import { useChangeLogRealtime } from '~/composables/change-log-realtime'

type LogTab = 'translations' | 'source'

const LOG_PAGE_SIZE = 50

export function useChangeLogPage() {
  const route = useRoute()
  const router = useRouter()

  const defaultTranslationData: EditorTranslationLogResponse = {
    entries: [],
    total: 0,
    page: 1,
    pageSize: LOG_PAGE_SIZE,
    totalPages: 1
  }

  const defaultTranslationSummaryData: EditorTranslationLogSummary = {
    pending: 0,
    approved: 0,
    rejected: 0,
    superseded: 0
  }

  const defaultSourceRevisionsData: EditorSourceRevisionsResponse = {
    revisions: []
  }

  const defaultSourceChangesData: EditorSourceChangesResponse = {
    entries: [],
    total: 0,
    page: 1,
    pageSize: LOG_PAGE_SIZE,
    totalPages: 1
  }

  const { diffMode } = useEditorPreferences()
  const diffModeIcons: Record<string, string> = {
    split: 'i-tabler-layout-columns',
    unified: 'i-tabler-arrows-diff'
  }
  const diffModeItems = [...EDITOR_DIFF_MODE_OPTIONS]
    .sort((left, right) => Number(right.key === 'split') - Number(left.key === 'split'))
    .map(option => ({
      label: option.label,
      value: option.key,
      icon: diffModeIcons[option.key]
    }))

  function updateDiffMode(value: string | number | undefined) {
    if (isEditorDiffMode(value)) {
      diffMode.value = value
    }
  }

  function getPage(value: unknown): number {
    const page = Number(getEditorQueryString(value) || '1')

    if (!Number.isInteger(page) || page < 1) {
      return 1
    }

    return Math.min(page, 100000)
  }

  function getInitialStatus(value: unknown): string {
    const status = getEditorQueryString(value)

    if (!status || status === 'all') {
      return ALL_STATUS_VALUE
    }

    return statusItems.some(item => item.value === status) ? status : ALL_STATUS_VALUE
  }

  const activeTab = ref<LogTab>(getEditorQueryString(route.query.tab) === 'source' ? 'source' : 'translations')
  const initialPage = getPage(route.query.p)
  const translationSearchInput = ref(getEditorQueryString(route.query.search))
  const translationSearch = ref(translationSearchInput.value.trim())
  const translationStatusFilter = ref(getInitialStatus(route.query.status))
  const translationPage = ref(activeTab.value === 'translations' ? initialPage : 1)
  const sourcePage = ref(activeTab.value === 'source' ? initialPage : 1)
  const sourceRevisionId = ref('')
  const pendingListScroll = ref<LogTab | null>(null)
  let applyingRouteQuery = false
  let pendingRouteQueryKey = ''

  const translationQuery = computed(() => ({
    page: translationPage.value,
    search: translationSearch.value || undefined,
    status: translationStatusFilter.value === ALL_STATUS_VALUE ? undefined : translationStatusFilter.value
  }))

  const { data: translationData, status: translationStatus, error: translationError, refresh: refreshTranslations }
    = useFetch<EditorTranslationLogResponse>('/api/editor/log/translations', {
      query: translationQuery,
      default: () => defaultTranslationData,
      server: false,
      lazy: true
    })

  const {
    data: translationSummaryData,
    status: translationSummaryStatus,
    error: translationSummaryError,
    refresh: refreshTranslationSummary
  } = useFetch<EditorTranslationLogSummary>('/api/editor/log/summary', {
    default: () => defaultTranslationSummaryData,
    server: false,
    lazy: true
  })

  const {
    data: overviewData,
    status: overviewStatus,
    error: overviewError,
    refresh: refreshOverview
  } = useFetch<EditorOverviewResponse>('/api/editor/overview', {
    default: createEmptyEditorOverview,
    server: false,
    lazy: true
  })

  const { data: sourceRevisionData, status: sourceRevisionStatus, error: sourceRevisionError, refresh: refreshSourceRevisions }
    = useFetch<EditorSourceRevisionsResponse>('/api/editor/log/source-revisions', {
      default: () => defaultSourceRevisionsData,
      immediate: activeTab.value === 'source',
      server: false,
      lazy: true
    })

  const sourceRevisions = computed<EditorSourceRevision[]>(() => sourceRevisionData.value?.revisions ?? [])
  const sourceRevisionItems = computed(() => sourceRevisions.value.map(revision => ({
    label: `v${revision.gameVersion} · r${revision.revision}`,
    value: revision.id
  })))
  const selectedRevision = computed(() => sourceRevisions.value.find(revision => revision.id === sourceRevisionId.value) ?? null)

  const sourceChangesQuery = computed(() => ({
    revisionId: sourceRevisionId.value || undefined,
    page: sourcePage.value
  }))

  const { data: sourceChangesData, status: sourceChangesStatus, error: sourceChangesError, refresh: refreshSourceChanges }
    = useFetch<EditorSourceChangesResponse>('/api/editor/log/source-changes', {
      query: sourceChangesQuery,
      default: () => defaultSourceChangesData,
      immediate: false,
      watch: false,
      server: false
    })

  watch(sourceRevisions, (revisions) => {
    if (!revisions.length) {
      sourceRevisionId.value = ''
      return
    }

    const routeVersion = normalizeEditorVersion(route.query.version)
    const routeRevisionValue = normalizeEditorRevision(route.query.revision)
    const routeRevision = routeVersion && routeRevisionValue
      ? revisions.find(revision =>
          normalizeEditorVersion(revision.gameVersion) === routeVersion
          && normalizeEditorRevision(revision.revision) === routeRevisionValue
        )
      : undefined
    const currentRevision = revisions.find(revision => revision.id === sourceRevisionId.value)
    const nextRevision = routeRevision ?? currentRevision ?? revisions[0]

    if (!nextRevision) {
      return
    }

    const revisionChanged = sourceRevisionId.value !== nextRevision.id
    sourceRevisionId.value = nextRevision.id

    if (activeTab.value === 'source') {
      const routeTab = getEditorQueryString(route.query.tab) === 'source'

      if (routeTab && (!routeVersion || !routeRevisionValue)) {
        syncLogRouteQuery('replace')
      }

      if (revisionChanged || !sourceChangesData.value?.entries.length) {
        void refreshSourceChanges()
      }
    }
  }, { immediate: activeTab.value === 'source' })

  watch(sourcePage, (page, previousPage) => {
    if (page === previousPage || !sourceRevisionId.value) {
      return
    }

    pendingListScroll.value = 'source'
    syncLogRouteQuery()
    void refreshSourceChanges()
  })

  const translationEntries = computed(() => translationData.value?.entries ?? [])
  const translationTotal = computed(() => translationData.value?.total ?? 0)
  const translationTotalPages = computed(() => translationData.value?.totalPages ?? 1)
  const translationSummary = computed(() => translationSummaryData.value ?? defaultTranslationSummaryData)
  useChangeLogRealtime({
    translationData, translationSummaryData, overviewData, translationStatus, translationQuery, translationSearch, translationStatusFilter, translationPage, defaultTranslationData
  })

  const overview = computed(() => overviewData.value ?? createEmptyEditorOverview())
  const latestVersion = computed(() => overview.value.versions[0] ?? null)
  const sourceEntries = computed(() => sourceChangesData.value?.entries ?? [])
  const sourceTotal = computed(() => sourceChangesData.value?.total ?? 0)
  const sourceTotalPages = computed(() => sourceChangesData.value?.totalPages ?? 1)
  const isLoading = computed(() => overviewStatus.value === 'idle' || overviewStatus.value === 'pending')
  const translationLoading = computed(() => translationStatus.value === 'idle' || translationStatus.value === 'pending')
  const translationSummaryLoading = computed(() => translationSummaryStatus.value === 'idle' || translationSummaryStatus.value === 'pending')
  const sourceLoading = computed(() =>
    sourceRevisionStatus.value === 'idle'
    || sourceRevisionStatus.value === 'pending'
    || (Boolean(sourceRevisionId.value) && (sourceChangesStatus.value === 'idle' || sourceChangesStatus.value === 'pending'))
  )

  let searchTimer: ReturnType<typeof setTimeout> | undefined

  watch(translationSearchInput, (value) => {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = undefined
    }

    if (applyingRouteQuery) {
      return
    }

    searchTimer = setTimeout(() => {
      searchTimer = undefined
      translationSearch.value = value.trim()
      translationPage.value = 1
      syncLogRouteQuery()
    }, 300)
  })

  watch(translationStatusFilter, () => {
    if (applyingRouteQuery) {
      return
    }

    translationPage.value = 1
    syncLogRouteQuery()
  })

  watch(translationPage, (page, previousPage) => {
    if (page !== previousPage) {
      pendingListScroll.value = 'translations'
    }

    syncLogRouteQuery()
  })

  async function scrollPageToTopAfterLoad(tab: LogTab): Promise<void> {
    if (pendingListScroll.value !== tab) {
      return
    }

    pendingListScroll.value = null

    if (activeTab.value !== tab) {
      return
    }

    await nextTick()

    if (!import.meta.client) {
      return
    }

    window.scrollTo({
      top: 0,
      behavior: 'auto'
    })
  }

  function clearPendingListScroll(tab: LogTab): void {
    if (pendingListScroll.value === tab) {
      pendingListScroll.value = null
    }
  }

  watch(translationStatus, (status) => {
    if (status === 'success') {
      void scrollPageToTopAfterLoad('translations')
    } else if (status === 'error') {
      clearPendingListScroll('translations')
    }
  })

  watch(sourceChangesStatus, (status) => {
    if (status === 'success') {
      void scrollPageToTopAfterLoad('source')
    } else if (status === 'error') {
      clearPendingListScroll('source')
    }
  })

  watch(translationTotalPages, (value) => {
    if (translationPage.value > value) {
      translationPage.value = value
    }
  })

  watch(sourceTotalPages, (value) => {
    if (sourcePage.value > value) {
      sourcePage.value = value
    }
  })

  onMounted(() => {
    syncLogRouteQuery('replace')
  })

  onBeforeUnmount(() => {
    if (searchTimer) {
      clearTimeout(searchTimer)
    }
  })

  function getLogQueryKey(query: Record<string, string>): string {
    return JSON.stringify(Object.entries(query).sort(([left], [right]) => left.localeCompare(right)))
  }

  function syncLogRouteQuery(mode: 'push' | 'replace' = 'push'): void {
    if (!import.meta.client || applyingRouteQuery) {
      return
    }

    const query: Record<string, string> = {
      tab: activeTab.value
    }

    if (activeTab.value === 'translations') {
      if (translationSearch.value) {
        query.search = translationSearch.value
      }

      if (translationStatusFilter.value !== ALL_STATUS_VALUE) {
        query.status = translationStatusFilter.value
      }

      if (translationPage.value > 1) {
        query.p = String(translationPage.value)
      }
    } else {
      if (sourcePage.value > 1) {
        query.p = String(sourcePage.value)
      }

      if (selectedRevision.value) {
        query.version = normalizeEditorVersion(selectedRevision.value.gameVersion)
        query.revision = normalizeEditorRevision(selectedRevision.value.revision)
      } else {
        const routeVersion = normalizeEditorVersion(route.query.version)
        const routeRevision = normalizeEditorRevision(route.query.revision)

        if (routeVersion && routeRevision) {
          query.version = routeVersion
          query.revision = routeRevision
        }
      }
    }

    const currentQuery = Object.fromEntries(
      Object.entries(route.query)
        .filter(([, value]) => typeof value === 'string' && value)
        .map(([key, value]) => [key, String(value)])
    )
    const nextKey = getLogQueryKey(query)

    if (nextKey === getLogQueryKey(currentQuery) || nextKey === pendingRouteQueryKey) {
      return
    }

    pendingRouteQueryKey = nextKey
    const navigation = mode === 'replace' ? router.replace : router.push

    void navigation({ path: route.path, query }).finally(() => {
      if (pendingRouteQueryKey === nextKey) {
        pendingRouteQueryKey = ''
      }
    })
  }

  async function applyLogRouteQuery(): Promise<void> {
    if (!import.meta.client) {
      return
    }

    applyingRouteQuery = true

    try {
      const nextTab: LogTab = getEditorQueryString(route.query.tab) === 'source' ? 'source' : 'translations'
      const nextPage = getPage(route.query.p)
      activeTab.value = nextTab

      if (nextTab === 'translations') {
        if (searchTimer) {
          clearTimeout(searchTimer)
          searchTimer = undefined
        }

        const nextSearch = getEditorQueryString(route.query.search).trim()
        translationSearchInput.value = nextSearch
        translationSearch.value = nextSearch
        translationStatusFilter.value = getInitialStatus(route.query.status)
        translationPage.value = nextPage
        return
      }

      const previousRevisionId = sourceRevisionId.value
      const previousPage = sourcePage.value
      sourcePage.value = nextPage
      const hadRevisions = sourceRevisions.value.length > 0

      if (!hadRevisions && sourceRevisionStatus.value !== 'pending') {
        await refreshSourceRevisions()
      }

      const routeVersion = normalizeEditorVersion(route.query.version)
      const routeRevisionValue = normalizeEditorRevision(route.query.revision)
      const routeRevision = routeVersion && routeRevisionValue
        ? sourceRevisions.value.find(revision =>
            normalizeEditorVersion(revision.gameVersion) === routeVersion
            && normalizeEditorRevision(revision.revision) === routeRevisionValue
          )
        : undefined
      const nextRevision = routeRevision ?? sourceRevisions.value[0]

      if (nextRevision) {
        sourceRevisionId.value = nextRevision.id
      }

      if (hadRevisions
        && sourceRevisionId.value
        && sourceRevisionId.value !== previousRevisionId
        && sourcePage.value === previousPage) {
        await refreshSourceChanges()
      }
    } finally {
      await nextTick()
      applyingRouteQuery = false
    }
  }

  watch(() => route.fullPath, () => {
    void applyLogRouteQuery()
  })

  async function updateActiveTab(value: string | number | undefined) {
    const nextTab: LogTab = value === 'source' ? 'source' : 'translations'

    if (nextTab === activeTab.value) {
      return
    }

    activeTab.value = nextTab

    if (nextTab === 'source') {
      if (!sourceRevisions.value.length && sourceRevisionStatus.value !== 'pending') {
        await refreshSourceRevisions()
      }

      if (!sourceRevisionId.value) {
        sourceRevisionId.value = sourceRevisions.value[0]?.id ?? ''
      }
    }

    syncLogRouteQuery()
  }

  function selectSourceRevision(value: string | undefined) {
    const nextRevisionId = value || sourceRevisions.value[0]?.id || ''

    if (nextRevisionId === sourceRevisionId.value) {
      return
    }

    sourceRevisionId.value = nextRevisionId
    const pageChanged = sourcePage.value !== 1
    sourcePage.value = 1
    syncLogRouteQuery()

    if (!pageChanged && sourceRevisionId.value) {
      void refreshSourceChanges()
    }
  }

  function getSourceRevisionLabel(): string {
    if (!selectedRevision.value) {
      return ''
    }

    return `v${selectedRevision.value.gameVersion} · r${selectedRevision.value.revision}`
  }

  async function retryActiveLog() {
    if (activeTab.value === 'translations') {
      await Promise.all([
        ...(translationError.value ? [refreshTranslations()] : []),
        ...(translationSummaryError.value ? [refreshTranslationSummary()] : []),
        ...(overviewError.value ? [refreshOverview()] : [])
      ])
      return
    }

    await Promise.all([
      ...(sourceRevisionError.value ? [refreshSourceRevisions()] : []),
      ...(sourceChangesError.value ? [refreshSourceChanges()] : [])
    ])
  }

  return {
    diffMode,
    diffModeItems,
    updateDiffMode,
    activeTab,
    translationSearchInput,
    translationStatusFilter,
    sourceRevisionId,
    sourceRevisionItems,
    updateActiveTab,
    selectSourceRevision,
    isLoading,
    latestVersion,
    translationSummaryLoading,
    translationSummaryError,
    translationSummary,
    translationLoading,
    translationError,
    translationEntries,
    translationTotal,
    translationTotalPages,
    translationPage,
    retryActiveLog,
    selectedRevision,
    getSourceRevisionLabel,
    sourceLoading,
    sourceEntries,
    sourceRevisionError,
    sourceChangesError,
    sourceRevisions,
    sourceTotal,
    sourceTotalPages,
    sourcePage
  }
}
