<script setup lang="ts">
import type {
  EditorChangeStatus,
  EditorSourceChangeEntry,
  EditorSourceChangesResponse,
  EditorSourceRevision,
  EditorSourceRevisionsResponse,
  EditorTranslationLogEntry,
  EditorLanguage,
  EditorTranslationLogResponse,
  EditorTranslationLogSummary
} from '#shared/types/editor'
import type { EditorOverviewResponse } from '#shared/types/editor-overview'
import { EDITOR_SOURCE_LANGUAGE_OPTIONS } from '~/utils/editor-options'
import {
  formatEditorCount,
  formatEditorDate,
  formatEditorVersion,
  getEditorQueryString,
  normalizeEditorHandle,
  normalizeEditorRevision,
  normalizeEditorVersion
} from '~/utils/editor-helpers'
import {
  getEditorDiffParts,
  type EditorDiffPart
} from '~/utils/editor-diff'

type LogTab = 'translations' | 'source'

interface LogDiffValue {
  key: string
  label: string
  parts: EditorDiffPart[]
}

interface TranslationStatusMeta {
  icon: string
  containerClass: string
  borderClass: string
  resultIcon: string
  resultIconClass: string
  resultLabel: string
  resultLabelClass: string
}

const ALL_STATUS_VALUE = '__all_status__'
const LOG_PAGE_SIZE = 50
const BOT_HANDLE = 'Bot'

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

function createDefaultOverview(): EditorOverviewResponse {
  return {
    overall: {
      total: 0,
      success: 0,
      info: 0,
      warning: 0,
      untranslated: 0
    },
    categories: [],
    versions: []
  }
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

const tabItems = [
  { label: '번역 수정', value: 'translations' },
  { label: '원문 변경', value: 'source' }
]

const statusItems = [
  { label: '모든 상태', value: ALL_STATUS_VALUE },
  { label: '승인 대기', value: 'pending' },
  { label: '승인됨', value: 'approved' },
  { label: '반려됨', value: 'rejected' },
  { label: '자동 종료', value: 'superseded' }
]

const sourceLanguageItems = EDITOR_SOURCE_LANGUAGE_OPTIONS

const statusLabels: Record<EditorChangeStatus, string> = {
  pending: '승인 대기',
  approved: '승인됨',
  rejected: '반려됨',
  superseded: '자동 종료'
}

const translationStatuses: EditorChangeStatus[] = ['pending', 'approved', 'rejected', 'superseded']

const translationStatusTextColors: Record<EditorChangeStatus, string> = {
  pending: 'text-warning',
  approved: 'text-success',
  rejected: 'text-error',
  superseded: 'text-muted'
}

const sourceChangeLabels = {
  added: '원문 추가',
  modified: '원문 변경',
  removed: '원문 삭제'
} as const

function getTranslationHandle(entry: EditorTranslationLogEntry): string {
  return normalizeEditorHandle(entry.handle)
}

function getReviewerHandle(entry: EditorTranslationLogEntry): string {
  return normalizeEditorHandle(entry.reviewerHandle)
}

function getReviewActionLabel(status: EditorChangeStatus): string {
  return getTranslationStatusMeta(status).resultLabel
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
  refresh: refreshOverview
} = useFetch<EditorOverviewResponse>('/api/editor/overview', {
  default: createDefaultOverview,
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
const overview = computed(() => overviewData.value ?? createDefaultOverview())
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

function getSourceValue(
  entry: EditorSourceChangeEntry,
  side: 'before' | 'after',
  language: EditorLanguage
): string | null {
  const values = side === 'before'
    ? {
        cnS: entry.beforeCnS,
        en: entry.beforeEn,
        jp: entry.beforeJp,
        cnT: entry.beforeCnT
      }
    : {
        cnS: entry.afterCnS,
        en: entry.afterEn,
        jp: entry.afterJp,
        cnT: entry.afterCnT
      }

  return values[language]
}

function makeUnifiedDiffValue(key: string, label: string, before: string | null, after: string | null): LogDiffValue {
  return {
    key,
    label,
    parts: getEditorDiffParts(before ?? '', after ?? '')
  }
}

function getTranslationDiffParts(entry: EditorTranslationLogEntry): EditorDiffPart[] {
  return getEditorDiffParts(entry.previousText ?? '', entry.proposedText)
}

function getSourceDiffValues(entry: EditorSourceChangeEntry): LogDiffValue[] {
  return sourceLanguageItems
    .map(language => makeUnifiedDiffValue(
      language.key,
      language.label,
      getSourceValue(entry, 'before', language.key),
      getSourceValue(entry, 'after', language.key)
    ))
    .filter((value, index) => {
      const language = sourceLanguageItems[index]!
      return getSourceValue(entry, 'before', language.key) !== getSourceValue(entry, 'after', language.key)
    })
}

function getTranslationStatusMeta(status: EditorChangeStatus): TranslationStatusMeta {
  return {
    pending: {
      icon: 'i-tabler-clock-hour-4',
      containerClass: 'bg-warning/15 text-warning',
      borderClass: 'border-warning',
      resultIcon: 'i-tabler-hourglass-empty',
      resultIconClass: 'text-warning',
      resultLabel: '승인 대기',
      resultLabelClass: 'text-warning'
    },
    approved: {
      icon: 'i-tabler-check',
      containerClass: 'bg-success/15 text-success',
      borderClass: 'border-success',
      resultIcon: 'i-tabler-check',
      resultIconClass: 'text-success',
      resultLabel: '승인',
      resultLabelClass: 'text-success'
    },
    rejected: {
      icon: 'i-tabler-x',
      containerClass: 'bg-error/15 text-error',
      borderClass: 'border-error',
      resultIcon: 'i-tabler-x',
      resultIconClass: 'text-error',
      resultLabel: '반려',
      resultLabelClass: 'text-error'
    },
    superseded: {
      icon: 'i-tabler-replace',
      containerClass: 'bg-elevated text-muted',
      borderClass: 'border-muted',
      resultIcon: 'i-tabler-minus',
      resultIconClass: 'text-muted',
      resultLabel: '종료',
      resultLabelClass: 'text-muted'
    }
  }[status]
}

function getSourceBorderClass(changeType: EditorSourceChangeEntry['changeType']): string {
  return {
    added: 'border-success',
    modified: 'border-warning',
    removed: 'border-error'
  }[changeType]
}

function getSourceTextClass(changeType: EditorSourceChangeEntry['changeType']): string {
  return {
    added: 'text-success',
    modified: 'text-warning',
    removed: 'text-error'
  }[changeType]
}

function getSourceActionIcon(changeType: EditorSourceChangeEntry['changeType']): string {
  return {
    added: 'i-tabler-database-plus',
    modified: 'i-tabler-database-import',
    removed: 'i-tabler-database-minus'
  }[changeType]
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
      refreshTranslations(),
      refreshTranslationSummary(),
      refreshOverview()
    ])
    return
  }

  await refreshSourceRevisions()
}
</script>

<template>
  <div class="flex flex-col h-full">
    <header class="flex flex-col gap-5">
      <div class="flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-tabler-history-toggle"
            class="size-5"
          />
          <h1 class="text-xl font-semibold -mt-0.75">
            변경 기록
          </h1>
        </div>

        <div class="flex items-center gap-2">
          <UButton
            to="/translate/editor"
            icon="i-tabler-arrow-right"
            color="info"
            variant="soft"
            size="md"
            class="px-3 shrink-0 flex-row-reverse self-start"
          >
            번역하러 가기
          </UButton>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <div class="flex flex-1 flex-col gap-2 p-4 bg-elevated/50 border border-default max-md:col-span-2">
          <span class="text-xs text-muted">최신 버전</span>
          <ClientOnly>
            <div
              v-if="isLoading"
              class="flex flex-col gap-1"
            >
              <USkeleton class="h-7 w-20" />
              <USkeleton class="h-4 w-28" />
            </div>
            <div
              v-else
              class="flex flex-col gap-1"
            >
              <span
                class="truncate text-xl font-semibold"
                :title="latestVersion ? formatEditorVersion(latestVersion.version, latestVersion.revision) : undefined"
              >
                {{ latestVersion ? formatEditorVersion(latestVersion.version, latestVersion.revision) : '—' }}
              </span>
              <time
                v-if="latestVersion"
                class="text-xs text-muted"
                :datetime="latestVersion.detectedAt"
              >
                {{ formatEditorDate(latestVersion.detectedAt) }}
              </time>
              <span
                v-else
                class="text-xs text-muted"
              >—</span>
            </div>
            <template #fallback>
              <div class="flex flex-col gap-1">
                <USkeleton class="h-7 w-20" />
                <USkeleton class="h-4 w-28" />
              </div>
            </template>
          </ClientOnly>
        </div>

        <div
          v-for="status in translationStatuses"
          :key="status"
          class="flex flex-col gap-2 p-4 bg-elevated/50 border border-default"
        >
          <span
            class="text-xs"
            :class="translationStatusTextColors[status]"
          >
            {{ statusLabels[status] }}
          </span>
          <ClientOnly>
            <USkeleton
              v-if="translationSummaryLoading"
              class="h-7 w-20"
            />
            <span
              v-else-if="translationSummaryError"
              class="text-xl font-semibold text-muted"
            >—</span>
            <span
              v-else
              class="text-xl font-semibold"
            >
              {{ formatEditorCount(translationSummary[status]) }}개
            </span>
            <template #fallback>
              <USkeleton class="h-7 w-20" />
            </template>
          </ClientOnly>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <UTabs
          :model-value="activeTab"
          :items="tabItems"
          :content="false"
          size="sm"
          color="neutral"
          class="w-fit"
          :ui="{ trigger: 'h-7 leading-4 px-3', list: 'h-9 bg-elevated/50 p-1' }"
          @update:model-value="updateActiveTab"
        />

        <div
          v-if="activeTab === 'translations'"
          class="flex gap-3 items-center"
        >
          <UInput
            v-model="translationSearchInput"
            icon="i-tabler-search"
            color="neutral"
            variant="soft"
            size="lg"
            placeholder="검색"
            class="h-9 w-full sm:flex-1"
            :ui="{ base: 'h-9 leading-5' }"
          />
          <USelect
            v-model="translationStatusFilter"
            :items="statusItems"
            color="neutral"
            variant="soft"
            size="lg"
            class="h-9 w-32"
            :ui="{ base: 'h-9 leading-5' }"
          />
        </div>

        <div
          v-else
          class="flex gap-3 items-center"
        >
          <USelect
            :model-value="sourceRevisionId"
            :items="sourceRevisionItems"
            color="neutral"
            variant="soft"
            size="lg"
            class="h-9 w-48"
            :ui="{ base: 'h-9 leading-5' }"
            :disabled="!sourceRevisionItems.length"
            @update:model-value="selectSourceRevision"
          />
        </div>
      </div>
    </header>

    <ClientOnly>
      <section
        v-if="activeTab === 'translations'"
        class="flex flex-col"
      >
        <div
          v-if="translationLoading && translationEntries.length"
          class="pointer-events-none sticky top-16 z-30 flex justify-center md:top-4"
          role="status"
          aria-live="polite"
        >
          <div
            class="absolute flex items-center gap-2 bg-elevated/80 px-3 py-2 text-sm text-muted shadow-sm backdrop-blur-lg"
          >
            <UIcon
              name="i-tabler-loader-2"
              class="size-4 animate-spin"
            />
            <span>불러오는 중</span>
          </div>
        </div>

        <UAlert
          v-if="translationError"
          class="my-4"
          color="error"
          variant="soft"
          title="번역 변경 기록을 불러오지 못했습니다."
          description="잠시 후 다시 시도해 주세요."
        >
          <template #actions>
            <UButton
              size="sm"
              color="error"
              variant="outline"
              @click="retryActiveLog"
            >
              다시 시도
            </UButton>
          </template>
        </UAlert>

        <div
          v-if="translationLoading && !translationEntries.length"
          class="flex items-center justify-center p-12 text-muted"
        >
          <AppLoadingSpinner />
        </div>

        <UAlert
          v-else-if="!translationError && !translationEntries.length"
          class="my-4"
          color="neutral"
          variant="soft"
          icon="i-tabler-history-off"
          title="번역 수정 기록이 없습니다."
          description="검색어나 상태 조건을 바꿔 보거나, 아직 저장된 번역 수정이 없는지 확인해 주세요."
        />

        <div
          v-else-if="translationEntries.length"
          class="relative flex flex-col gap-5 pt-5"
        >
          <span class="shrink-0 text-xs text-muted">
            총 {{ translationTotal.toLocaleString() }}건
          </span>

          <article
            v-for="entry in translationEntries"
            :key="entry.id"
            class="flex flex-col border-l-2 border-r border-r-default max-md:-ml-0.5"
            :class="getTranslationStatusMeta(entry.status).borderClass"
          >
            <p
              class="min-h-5 whitespace-pre-wrap wrap-break-word p-3 md:px-5 md:py-4 text-sm leading-6 bg-muted border-y border-default"
            >
              <template
                v-for="(part, partIndex) in getTranslationDiffParts(entry)"
                :key="`${part.type}-${partIndex}`"
              >
                <span
                  :class="part.type === 'removed'
                    ? 'bg-error/10 text-error'
                    : part.type === 'added'
                      ? 'bg-success/10 text-success'
                      : 'text-toned'"
                >{{ part.text }}</span>
              </template>
            </p>

            <div class="flex flex-col gap-2 p-3 md:px-5 md:py-4 border-b border-default text-xs">
              <div class="flex items-center gap-1.5">
                <UIcon
                  name="i-tabler-file-filled"
                  class="size-3.5 text-muted"
                />
                <NuxtLink
                  :to="{
                    path: '/translate/editor',
                    query: {
                      file: entry.category,
                      search: `${entry.category}_${entry.unitKey}`,
                      searchType: 'key',
                      match: 'exact',
                      page: '1'
                    }
                  }"
                  class="min-w-0 truncate hover:underline underline-offset-2"
                  :title="`${entry.category}_${entry.unitKey}`"
                >
                  {{ entry.category }}_{{ entry.unitKey }}
                </NuxtLink>
              </div>

              <div class="flex min-w-0 items-center gap-1.5">
                <UIcon
                  name="i-tabler-git-pull-request"
                  class="size-3.5 text-muted"
                />
                <AppUserIdentity
                  :handle="getTranslationHandle(entry)"
                  :role="entry.actorRole"
                  text-class="text-xs"
                  icon-class="size-3.5"
                  stop-propagation
                />
                <time
                  class="text-muted"
                  :datetime="entry.createdAt"
                >{{ formatEditorDate(entry.createdAt) }}</time>
              </div>

              <div
                v-if="entry.reviewedAt"
                class="flex min-w-0 items-center gap-1.5"
              >
                <UIcon
                  :name="getTranslationStatusMeta(entry.status).resultIcon"
                  class="size-3.5"
                  :class="getTranslationStatusMeta(entry.status).resultIconClass"
                />
                <span :class="getTranslationStatusMeta(entry.status).resultLabelClass">
                  {{ getReviewActionLabel(entry.status) }}
                </span>
                <AppUserIdentity
                  :handle="getReviewerHandle(entry)"
                  :role="entry.reviewerRole"
                  fallback="시스템"
                  text-class="text-xs"
                  icon-class="size-3.5"
                  stop-propagation
                />
                <time
                  class="text-muted"
                  :datetime="entry.reviewedAt"
                >{{ formatEditorDate(entry.reviewedAt) }}</time>
              </div>
            </div>
          </article>
        </div>

        <div
          v-if="translationTotal"
          class="sticky bottom-4 z-20 flex justify-center pt-5 pointer-events-none"
        >
          <EditorPageController
            v-model:page="translationPage"
            :total-pages="translationTotalPages"
            :disabled="translationLoading"
            class="relative pointer-events-auto"
          />
        </div>
      </section>

      <section
        v-else
        class="flex flex-col pt-5"
      >
        <div
          v-if="selectedRevision"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 bg-muted px-4 py-3 text-xs text-muted border border-default"
        >
          <span class="font-medium text-toned">{{ getSourceRevisionLabel() }}</span>
          <span>{{ formatEditorDate(selectedRevision.detectedAt) }}</span>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="text-success">추가 {{ selectedRevision.addedCount }}</span>
            <span class="text-warning">수정 {{ selectedRevision.modifiedCount }}</span>
            <span class="text-error">삭제 {{ selectedRevision.removedCount }}</span>
          </div>
        </div>

        <div
          v-if="sourceLoading && sourceEntries.length"
          class="pointer-events-none sticky top-16 z-30 flex justify-center md:top-4"
          role="status"
          aria-live="polite"
        >
          <div
            class="absolute flex items-center gap-2 bg-elevated/80 px-3 py-2 text-sm text-muted shadow-sm backdrop-blur-lg"
          >
            <UIcon
              name="i-tabler-loader-2"
              class="size-4 animate-spin"
            />
            <span>불러오는 중</span>
          </div>
        </div>

        <UAlert
          v-if="sourceRevisionError || sourceChangesError"
          class="my-4"
          color="error"
          variant="soft"
          title="원문 변경 기록을 불러오지 못했습니다."
          description="잠시 후 다시 시도해 주세요."
        >
          <template #actions>
            <UButton
              size="sm"
              color="error"
              variant="outline"
              @click="retryActiveLog"
            >
              다시 시도
            </UButton>
          </template>
        </UAlert>

        <div
          v-if="sourceLoading && !sourceEntries.length"
          class="flex items-center justify-center p-12 text-muted"
        >
          <AppLoadingSpinner />
        </div>

        <UAlert
          v-else-if="!sourceRevisionError && !sourceChangesError && !sourceRevisions.length"
          class="my-4"
          color="neutral"
          variant="soft"
          icon="i-tabler-file-off"
          title="원문 변경 기록이 없습니다."
          description="Bot이 감지한 원문 변경이 아직 등록되지 않았습니다."
        />

        <UAlert
          v-else-if="!sourceChangesError && sourceRevisionId && !sourceEntries.length"
          class="my-4"
          color="neutral"
          variant="soft"
          icon="i-tabler-file-search"
          title="선택한 버전에 변경 항목이 없습니다."
          description="다른 버전·리비전을 선택해 보세요."
        />

        <div
          v-else-if="sourceEntries.length"
          class="relative flex flex-col gap-5 pt-5"
        >
          <span class="shrink-0 text-xs text-muted">
            총 {{ sourceTotal.toLocaleString() }}건
          </span>

          <article
            v-for="entry in sourceEntries"
            :key="entry.id"
            class="flex flex-col border-l-2 border-r border-r-default max-md:-ml-0.5"
            :class="getSourceBorderClass(entry.changeType)"
          >
            <div class="flex flex-col gap-3 p-3 md:px-5 md:py-4 bg-muted border-y border-default">
              <div
                v-for="value in getSourceDiffValues(entry)"
                :key="value.key"
                class="flex min-w-0 flex-col gap-0.5"
              >
                <span class="block text-[10px] text-dimmed">{{ value.label }}</span>
                <p class="min-h-5 whitespace-pre-wrap wrap-break-word text-sm leading-6">
                  <template
                    v-for="(part, partIndex) in value.parts"
                    :key="`${part.type}-${partIndex}`"
                  >
                    <span
                      :class="part.type === 'removed'
                        ? 'bg-error/10 text-error'
                        : part.type === 'added'
                          ? 'bg-success/10 text-success'
                          : 'text-toned'"
                    >{{ part.text }}</span>
                  </template>
                </p>
              </div>
            </div>

            <div class="flex flex-col gap-2 p-3 md:px-5 md:py-4 border-b border-default text-xs">
              <div class="flex items-center gap-1.5">
                <UIcon
                  name="i-tabler-file-filled"
                  class="size-3.5 text-muted"
                />
                <NuxtLink
                  :to="{
                    path: '/translate/editor',
                    query: {
                      file: entry.category,
                      search: `${entry.category}_${entry.unitKey}`,
                      searchType: 'key',
                      match: 'exact',
                      page: '1'
                    }
                  }"
                  class="min-w-0 truncate hover:underline underline-offset-2"
                  :title="`${entry.category}_${entry.unitKey}`"
                >
                  {{ entry.category }}_{{ entry.unitKey }}
                </NuxtLink>
              </div>

              <div class="flex min-w-0 items-center gap-1.5">
                <UIcon
                  name="i-tabler-git-pull-request"
                  class="size-3.5 text-muted"
                />
                <AppUserIdentity
                  :handle="BOT_HANDLE"
                  role="bot"
                  text-class="text-xs"
                  icon-class="size-3.5"
                  stop-propagation
                />
                <time
                  class="text-muted"
                  :datetime="entry.createdAt"
                >{{ formatEditorDate(entry.createdAt) }}</time>
              </div>

              <div class="flex items-center gap-1.5">
                <UIcon
                  :name="getSourceActionIcon(entry.changeType)"
                  class="size-3.5"
                  :class="getSourceTextClass(entry.changeType)"
                />
                <span :class="getSourceTextClass(entry.changeType)">
                  {{ sourceChangeLabels[entry.changeType] }}
                </span>
              </div>

              <div class="flex items-center gap-1.5 text-muted">
                <UIcon
                  name="i-tabler-tag"
                  class="size-3.5"
                />
                <span>{{ getSourceRevisionLabel() }}</span>
              </div>
            </div>
          </article>
        </div>

        <div
          v-if="sourceTotal"
          class="sticky bottom-4 z-20 flex justify-center pt-5 pointer-events-none"
        >
          <EditorPageController
            v-model:page="sourcePage"
            :total-pages="sourceTotalPages"
            :disabled="sourceLoading"
            class="relative pointer-events-auto"
          />
        </div>
      </section>

      <template #fallback>
        <div class="flex items-center justify-center p-12 text-muted">
          <AppLoadingSpinner />
        </div>
      </template>
    </ClientOnly>
  </div>
</template>
