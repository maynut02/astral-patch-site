<script setup lang="ts">
import type {
  EditorChangeStatus,
  EditorSourceChangeEntry,
  EditorSourceChangesResponse,
  EditorSourceRevision,
  EditorSourceRevisionsResponse,
  EditorTranslationLogEntry,
  EditorTranslationLogResponse
} from '#shared/types/editor'
import {
  formatEditorDate as formatDate,
  getEditorQueryString as getQueryString,
  normalizeEditorHandle as normalizeHandle
} from '~/utils/editor-helpers'
import {
  getEditorDiffParts,
  type EditorDiffPart
} from '~/utils/editor-diff'

type LogTab = 'translations' | 'source'
type SourceLanguageKey = 'cnS' | 'en' | 'jp' | 'cnT'

interface LogDiffValue {
  key: string
  label: string
  parts: EditorDiffPart[]
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

const sourceLanguageItems: { key: SourceLanguageKey, label: string }[] = [
  { key: 'cnS', label: '중국어 간체' },
  { key: 'en', label: '영어' },
  { key: 'jp', label: '일본어' },
  { key: 'cnT', label: '중국어 번체' }
]

const statusLabels: Record<EditorChangeStatus, string> = {
  pending: '승인 대기',
  approved: '승인됨',
  rejected: '반려됨',
  superseded: '자동 종료'
}

const sourceChangeLabels = {
  added: '원문 추가',
  modified: '원문 변경',
  removed: '원문 삭제'
} as const

function getTranslationHandle(entry: EditorTranslationLogEntry): string {
  return normalizeHandle(entry.handle)
}

function getReviewerHandle(entry: EditorTranslationLogEntry): string {
  return normalizeHandle(entry.reviewerHandle)
}

function getReviewActionLabel(status: EditorChangeStatus): string {
  return {
    pending: '승인 대기',
    approved: '승인',
    rejected: '반려',
    superseded: '종료'
  }[status]
}

function getPage(value: unknown): number {
  const page = Number(getQueryString(value) || '1')

  if (!Number.isInteger(page) || page < 1) {
    return 1
  }

  return Math.min(page, 100000)
}

function getInitialStatus(value: unknown): string {
  const status = getQueryString(value)

  if (!status || status === 'all') {
    return ALL_STATUS_VALUE
  }

  return statusItems.some(item => item.value === status) ? status : ALL_STATUS_VALUE
}

function normalizeLogVersion(value: unknown): string {
  return getQueryString(value).trim().replace(/^v/i, '')
}

function normalizeLogRevision(value: unknown): string {
  return getQueryString(value).trim().replace(/^r/i, '')
}

const activeTab = ref<LogTab>(getQueryString(route.query.tab) === 'source' ? 'source' : 'translations')
const initialPage = getPage(route.query.p)
const translationSearchInput = ref(getQueryString(route.query.search))
const translationSearch = ref(translationSearchInput.value.trim())
const translationStatusFilter = ref(getInitialStatus(route.query.status))
const translationPage = ref(activeTab.value === 'translations' ? initialPage : 1)
const sourcePage = ref(activeTab.value === 'source' ? initialPage : 1)
const sourceRevisionId = ref('')
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

  const routeVersion = normalizeLogVersion(route.query.version)
  const routeRevisionValue = normalizeLogRevision(route.query.revision)
  const routeRevision = routeVersion && routeRevisionValue
    ? revisions.find(revision =>
      normalizeLogVersion(revision.gameVersion) === routeVersion
      && normalizeLogRevision(revision.revision) === routeRevisionValue
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
    const routeTab = getQueryString(route.query.tab) === 'source'

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

  syncLogRouteQuery()
  void refreshSourceChanges()
})

const translationEntries = computed(() => translationData.value?.entries ?? [])
const translationTotal = computed(() => translationData.value?.total ?? 0)
const translationTotalPages = computed(() => translationData.value?.totalPages ?? 1)
const sourceEntries = computed(() => sourceChangesData.value?.entries ?? [])
const sourceTotal = computed(() => sourceChangesData.value?.total ?? 0)
const sourceTotalPages = computed(() => sourceChangesData.value?.totalPages ?? 1)
const translationLoading = computed(() => translationStatus.value === 'idle' || translationStatus.value === 'pending')
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

watch(translationPage, () => {
  syncLogRouteQuery()
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
      query.version = normalizeLogVersion(selectedRevision.value.gameVersion)
      query.revision = normalizeLogRevision(selectedRevision.value.revision)
    } else {
      const routeVersion = normalizeLogVersion(route.query.version)
      const routeRevision = normalizeLogRevision(route.query.revision)

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
    const nextTab: LogTab = getQueryString(route.query.tab) === 'source' ? 'source' : 'translations'
    const nextPage = getPage(route.query.p)
    activeTab.value = nextTab

    if (nextTab === 'translations') {
      if (searchTimer) {
        clearTimeout(searchTimer)
        searchTimer = undefined
      }

      const nextSearch = getQueryString(route.query.search).trim()
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

    const routeVersion = normalizeLogVersion(route.query.version)
    const routeRevisionValue = normalizeLogRevision(route.query.revision)
    const routeRevision = routeVersion && routeRevisionValue
      ? sourceRevisions.value.find(revision =>
        normalizeLogVersion(revision.gameVersion) === routeVersion
        && normalizeLogRevision(revision.revision) === routeRevisionValue
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
  language: SourceLanguageKey
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

function getTranslationStatusMeta(status: EditorChangeStatus): {
  icon: string
  containerClass: string
} {
  return {
    pending: {
      icon: 'i-tabler-clock-hour-4',
      containerClass: 'bg-warning/15 text-warning'
    },
    approved: {
      icon: 'i-tabler-check',
      containerClass: 'bg-success/15 text-success'
    },
    rejected: {
      icon: 'i-tabler-x',
      containerClass: 'bg-error/15 text-error'
    },
    superseded: {
      icon: 'i-tabler-replace',
      containerClass: 'bg-elevated text-muted'
    }
  }[status]
}

function getSourceToneClass(changeType: EditorSourceChangeEntry['changeType']): string {
  return {
    added: 'bg-success/15 text-success',
    modified: 'bg-warning/15 text-warning',
    removed: 'bg-error/15 text-error'
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
    await refreshTranslations()
    return
  }

  await refreshSourceRevisions()
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-400 flex-col gap-3 px-3 py-5 md:px-5">
    <div class="flex items-center justify-between gap-5">
      <h1 class="text-xl font-semibold md:text-2xl">
        변경 기록
      </h1>
    </div>

    <div class="flex flex-col md:flex-row gap-3">
      <UTabs :model-value="activeTab" :items="tabItems" :content="false" size="xs" color="neutral" class="w-fit"
        :ui="{ trigger: 'px-3', list: 'bg-muted' }" @update:model-value="updateActiveTab" />

      <div v-if="activeTab === 'translations'" class="flex gap-3 items-center">
        <UInput v-model="translationSearchInput" icon="i-tabler-search" color="neutral" variant="soft" placeholder="검색"
          class="w-full sm:flex-1" />
        <USelect v-model="translationStatusFilter" :items="statusItems" color="neutral" variant="soft" class="w-28" />
      </div>

      <div v-else class="flex gap-3 items-center">
        <USelect :model-value="sourceRevisionId" :items="sourceRevisionItems" color="neutral" variant="soft"
          class="w-full sm:w-48" :disabled="!sourceRevisionItems.length" @update:model-value="selectSourceRevision" />
      </div>
    </div>

    <ClientOnly>
      <section v-if="activeTab === 'translations'" class="flex flex-col">
        <UAlert v-if="translationError" class="my-4" color="error" variant="soft" title="번역 변경 기록을 불러오지 못했습니다."
          description="잠시 후 다시 시도해 주세요.">
          <template #actions>
            <UButton size="sm" color="error" variant="outline" @click="retryActiveLog">
              다시 시도
            </UButton>
          </template>
        </UAlert>

        <div v-if="translationLoading && !translationEntries.length"
          class="flex items-center justify-center p-12 text-muted">
          <AppLoadingSpinner />
        </div>

        <UAlert v-else-if="!translationError && !translationEntries.length" class="my-4" color="neutral" variant="soft"
          icon="i-tabler-history-off" title="번역 수정 기록이 없습니다."
          description="검색어나 상태 조건을 바꿔 보거나, 아직 저장된 번역 수정이 없는지 확인해 주세요." />

        <div v-else-if="translationEntries.length" class="relative flex flex-col">
          <div v-if="translationLoading" class="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
            <div
              class="flex items-center gap-2 rounded-lg bg-elevated/80 px-3 py-2 text-xs text-muted shadow-sm backdrop-blur-lg">
              <UIcon name="i-tabler-loader-2" class="size-4 animate-spin" />
              <span>불러오는 중</span>
            </div>
          </div>
          <span class="shrink-0 text-xs text-muted pb-3">
            총 {{ translationTotal.toLocaleString() }}건
          </span>

          <article v-for="(entry, index) in translationEntries" :key="entry.id"
            class="flex flex-col pt-1 transition-colors rounded-lg">
            <div class="flex items-center gap-2">
              <div class="flex size-6 shrink-0 items-center justify-center rounded-full"
                :class="getTranslationStatusMeta(entry.status).containerClass" :title="statusLabels[entry.status]"
                :aria-label="statusLabels[entry.status]">
                <UIcon :name="getTranslationStatusMeta(entry.status).icon" class="size-4" />
              </div>

              <NuxtLink :to="{
                path: '/translate/editor',
                query: {
                  file: entry.category,
                  search: `${entry.category}_${entry.unitKey}`,
                  searchType: 'key',
                  match: 'exact',
                  page: '1'
                }
              }" class="min-w-0 flex-1 truncate text-sm font-medium text-default hover:underline underline-offset-2"
                :title="`${entry.category}_${entry.unitKey}`">
                {{ entry.category }}_{{ entry.unitKey }}
              </NuxtLink>
            </div>

            <div class="flex gap-2">
              <div class="flex w-6 shrink-0 justify-center pt-1">
                <div v-if="index < translationEntries.length - 1" class="w-0.5 rounded-lg bg-elevated" />
              </div>

              <div class="flex min-w-0 flex-1 flex-col gap-4 pb-12">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="text-dimmed">생성</span>
                    <time :datetime="entry.createdAt">{{ formatDate(entry.createdAt) }}</time>
                    <span aria-hidden="true">·</span>
                    <AppUserIdentity :handle="getTranslationHandle(entry)" :role="entry.actorRole"
                      text-class="text-xs text-muted" icon-class="size-3.5" stop-propagation />
                  </span>

                  <span v-if="entry.reviewedAt" class="flex min-w-0 items-center gap-1.5">
                    <span class="text-dimmed">{{ getReviewActionLabel(entry.status) }}</span>
                    <time :datetime="entry.reviewedAt">{{ formatDate(entry.reviewedAt) }}</time>
                    <span aria-hidden="true">·</span>
                    <AppUserIdentity :handle="getReviewerHandle(entry)" :role="entry.reviewerRole" fallback="시스템"
                      text-class="text-xs text-muted" icon-class="size-3.5" stop-propagation />
                  </span>
                </div>

                <p class="min-h-5 whitespace-pre-wrap wrap-break-word px-3 py-2 bg-muted rounded-lg text-sm leading-6">
                  <template v-for="(part, partIndex) in getTranslationDiffParts(entry)"
                    :key="`${part.type}-${partIndex}`">
                    <span :class="part.type === 'removed'
                      ? 'bg-error/10 text-error'
                      : part.type === 'added'
                        ? 'bg-success/10 text-success'
                        : 'text-toned'">{{ part.text }}</span>
                  </template>
                </p>
              </div>
            </div>
          </article>
        </div>

        <div v-if="translationTotal" class="sticky bottom-4 z-20 flex justify-center pt-5 pointer-events-none">
          <EditorPageController v-model:page="translationPage" :total-pages="translationTotalPages"
            :disabled="translationLoading" class="pointer-events-auto" />
        </div>
      </section>

      <section v-else class="flex flex-col">
        <span class="shrink-0 text-xs text-muted pb-3">
          총 {{ sourceTotal.toLocaleString() }}건
        </span>

        <div v-if="selectedRevision"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 bg-muted rounded-md px-4 py-3 text-xs text-muted">
          <span class="font-medium text-toned">{{ getSourceRevisionLabel() }}</span>
          <span>생성: {{ formatDate(selectedRevision.detectedAt) }}</span>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="text-success">추가 {{ selectedRevision.addedCount }}</span>
            <span class="text-warning">수정 {{ selectedRevision.modifiedCount }}</span>
            <span class="text-error">삭제 {{ selectedRevision.removedCount }}</span>
          </div>
        </div>

        <UAlert v-if="sourceRevisionError || sourceChangesError" class="my-4" color="error" variant="soft"
          title="원문 변경 기록을 불러오지 못했습니다." description="잠시 후 다시 시도해 주세요.">
          <template #actions>
            <UButton size="sm" color="error" variant="outline" @click="retryActiveLog">
              다시 시도
            </UButton>
          </template>
        </UAlert>

        <div v-if="sourceLoading && !sourceEntries.length" class="flex items-center justify-center p-12 text-muted">
          <AppLoadingSpinner />
        </div>

        <UAlert v-else-if="!sourceRevisionError && !sourceChangesError && !sourceRevisions.length" class="my-4"
          color="neutral" variant="soft" icon="i-tabler-file-off" title="원문 변경 기록이 없습니다."
          description="Bot이 감지한 원문 변경이 아직 등록되지 않았습니다." />

        <UAlert v-else-if="!sourceChangesError && sourceRevisionId && !sourceEntries.length" class="my-4"
          color="neutral" variant="soft" icon="i-tabler-file-search" title="선택한 버전에 변경 항목이 없습니다."
          description="다른 버전·리비전을 선택해 보세요." />

        <div v-else-if="sourceEntries.length" class="relative flex flex-col pt-3">
          <div v-if="sourceLoading" class="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
            <div
              class="flex items-center gap-2 rounded-lg bg-elevated/80 px-3 py-2 text-xs text-muted shadow-sm backdrop-blur-lg">
              <UIcon name="i-tabler-loader-2" class="size-4 animate-spin" />
              <span>불러오는 중</span>
            </div>
          </div>
          <article v-for="(entry, index) in sourceEntries" :key="entry.id" class="flex flex-col pt-1 transition-colors">
            <div class="flex items-center gap-2">
              <div class="flex size-6 shrink-0 items-center justify-center rounded-full"
                :class="getSourceToneClass(entry.changeType)">
                <UIcon :name="getSourceActionIcon(entry.changeType)" class="size-4" />
              </div>

              <NuxtLink :to="{
                path: '/translate/editor',
                query: {
                  file: entry.category,
                  search: `${entry.category}_${entry.unitKey}`,
                  searchType: 'key',
                  match: 'exact',
                  page: '1'
                }
              }" class="min-w-0 flex-1 truncate text-sm font-medium text-default hover:underline underline-offset-2"
                :title="`${entry.category}_${entry.unitKey}`">
                {{ entry.category }}_{{ entry.unitKey }}
              </NuxtLink>
            </div>

            <div class="flex gap-2">
              <div class="flex w-6 shrink-0 justify-center pt-1">
                <div v-if="index < sourceEntries.length - 1" class="w-0.5 rounded-lg bg-elevated" />
              </div>

              <div class="flex min-w-0 flex-1 flex-col gap-4 pb-12">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span class="font-medium" :class="getSourceTextClass(entry.changeType)">
                    {{ sourceChangeLabels[entry.changeType] }}
                  </span>
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="text-dimmed">생성</span>
                    <time :datetime="entry.createdAt">{{ formatDate(entry.createdAt) }}</time>
                    <span aria-hidden="true">·</span>
                    <AppUserIdentity :handle="BOT_HANDLE" role="bot" text-class="text-xs text-muted"
                      icon-class="size-3.5" stop-propagation />
                  </span>
                  <span class="flex items-center gap-1">
                    <UIcon name="i-tabler-tag" class="size-3" />
                    {{ getSourceRevisionLabel() }}
                  </span>
                </div>

                <div class="flex flex-col gap-4 py-2">
                  <div v-for="value in getSourceDiffValues(entry)" :key="value.key"
                    class="flex min-w-0 flex-col gap-0.5">
                    <span class="block text-[10px] text-dimmed">{{ value.label }}</span>
                    <p
                      class="min-h-5 whitespace-pre-wrap wrap-break-word text-sm leading-6 px-3 py-2 bg-muted rounded-lg">
                      <template v-for="(part, partIndex) in value.parts" :key="`${part.type}-${partIndex}`">
                        <span :class="part.type === 'removed'
                          ? 'bg-error/10 text-error'
                          : part.type === 'added'
                            ? 'bg-success/10 text-success'
                            : 'text-toned'">{{ part.text }}</span>
                      </template>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>

        <div v-if="sourceTotal" class="sticky bottom-4 z-20 flex justify-center pt-5 pointer-events-none">
          <EditorPageController v-model:page="sourcePage" :total-pages="sourceTotalPages" :disabled="sourceLoading"
            class="pointer-events-auto" />
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
