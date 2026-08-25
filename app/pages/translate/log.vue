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

type LogTab = 'translations' | 'source'
type SourceLanguageKey = 'cnS' | 'en' | 'jp' | 'cnT'
type TranslationLogEntryWithHandle = EditorTranslationLogEntry & { handle?: string | null }

const ALL_STATUS_VALUE = '__all_status__'
const LOG_PAGE_SIZE = 50
const BOT_HANDLE = 'Bot'

const route = useRoute()
const { loggedIn } = useUserSession()

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
  { label: '번역 수정', value: 'translations', icon: 'i-tabler-language' },
  { label: '원문 변경', value: 'source', icon: 'i-tabler-file-delta' }
]

const statusItems = [
  { label: '모든 상태', value: ALL_STATUS_VALUE },
  { label: '승인 대기', value: 'pending' },
  { label: '승인됨', value: 'approved' },
  { label: '반려됨', value: 'rejected' },
  { label: '대체됨', value: 'superseded' }
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
  superseded: '대체됨'
}

const statusColors: Record<EditorChangeStatus, 'warning' | 'success' | 'error' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  superseded: 'neutral'
}

const sourceChangeLabels = {
  added: '새 항목',
  modified: '원문 수정',
  removed: '항목 삭제'
} as const

const sourceChangeColors = {
  added: 'success',
  modified: 'warning',
  removed: 'error'
} as const

function getQueryString(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

function normalizeHandle(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^@+/, '') : ''
}

function getUserPath(handle: string): string {
  return `/@${encodeURIComponent(handle)}`
}

function formatHandle(handle: string): string {
  return `@${handle}`
}

function getTranslationHandle(entry: EditorTranslationLogEntry): string {
  return normalizeHandle((entry as TranslationLogEntryWithHandle).handle)
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

  return statusItems.some(item => item.value === status) ? status : ALL_STATUS_VALUE
}

const activeTab = ref<LogTab>(getQueryString(route.query.tab) === 'source' ? 'source' : 'translations')
const translationSearchInput = ref(getQueryString(route.query.search))
const translationSearch = ref(translationSearchInput.value.trim())
const translationStatusFilter = ref(getInitialStatus(route.query.status))
const translationPage = ref(getPage(route.query.translationPage))
const sourceRevisionId = ref(getQueryString(route.query.revisionId))
const sourcePage = ref(getPage(route.query.sourcePage))

const translationQuery = computed(() => ({
  page: translationPage.value,
  search: translationSearch.value || undefined,
  status: translationStatusFilter.value === ALL_STATUS_VALUE ? undefined : translationStatusFilter.value
}))

const { data: translationData, status: translationStatus, error: translationError, refresh: refreshTranslations } =
  await useFetch<EditorTranslationLogResponse>('/api/editor/log/translations', {
    query: translationQuery,
    default: () => defaultTranslationData,
    watch: [translationQuery]
  })

const { data: sourceRevisionData, status: sourceRevisionStatus, error: sourceRevisionError, refresh: refreshSourceRevisions } =
  await useFetch<EditorSourceRevisionsResponse>('/api/editor/log/source-revisions', {
    default: () => defaultSourceRevisionsData
  })

const sourceRevisions = computed<EditorSourceRevision[]>(() => sourceRevisionData.value?.revisions ?? [])
const sourceRevisionItems = computed(() => sourceRevisions.value.map(revision => ({
  label: `v${revision.gameVersion} · r${revision.revision} · ${revision.totalChanges.toLocaleString()}개 변경`,
  value: revision.id
})))
const selectedRevision = computed(() => sourceRevisions.value.find(revision => revision.id === sourceRevisionId.value) ?? null)

watch(sourceRevisions, (revisions) => {
  if (!revisions.length) {
    sourceRevisionId.value = ''
    return
  }

  if (!revisions.some(revision => revision.id === sourceRevisionId.value)) {
    sourceRevisionId.value = revisions[0]?.id ?? ''
  }
}, { immediate: true })

watch(sourceRevisionId, () => {
  sourcePage.value = 1
})

const sourceChangesQuery = computed(() => ({
  revisionId: sourceRevisionId.value || undefined,
  page: sourcePage.value
}))

const { data: sourceChangesData, status: sourceChangesStatus, error: sourceChangesError, refresh: refreshSourceChanges } =
  await useFetch<EditorSourceChangesResponse>('/api/editor/log/source-changes', {
    query: sourceChangesQuery,
    default: () => defaultSourceChangesData,
    immediate: Boolean(sourceRevisionId.value),
    watch: [sourceChangesQuery]
  })

const translationEntries = computed(() => translationData.value?.entries ?? [])
const translationTotal = computed(() => translationData.value?.total ?? 0)
const translationTotalPages = computed(() => translationData.value?.totalPages ?? 1)
const sourceEntries = computed(() => sourceChangesData.value?.entries ?? [])
const sourceTotal = computed(() => sourceChangesData.value?.total ?? 0)
const sourceTotalPages = computed(() => sourceChangesData.value?.totalPages ?? 1)
const translationLoading = computed(() => translationStatus.value === 'pending')
const sourceLoading = computed(() => sourceRevisionStatus.value === 'pending' || sourceChangesStatus.value === 'pending')
const activeLoading = computed(() => activeTab.value === 'translations' ? translationLoading.value : sourceLoading.value)

const selectedTranslation = ref<EditorTranslationLogEntry | null>(null)
const selectedSource = ref<EditorSourceChangeEntry | null>(null)
const detailOpen = ref(false)
const selectedUnitId = computed(() => selectedTranslation.value?.unitId ?? selectedSource.value?.unitId ?? '')

let searchTimer: ReturnType<typeof setTimeout> | undefined

watch(translationSearchInput, (value) => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }

  searchTimer = setTimeout(() => {
    searchTimer = undefined
    translationSearch.value = value.trim()
    translationPage.value = 1
  }, 300)
})

watch(translationStatusFilter, () => {
  translationPage.value = 1
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

onBeforeUnmount(() => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
})

function updateActiveTab(value: string | number | undefined) {
  activeTab.value = value === 'source' ? 'source' : 'translations'
}

function selectSourceRevision(value: string | undefined) {
  sourceRevisionId.value = value || sourceRevisions.value[0]?.id || ''
}

function formatDate(value: string | null): string {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function previewText(value: string | null, fallback = '없음'): string {
  const text = value?.trim() || ''

  if (!text) {
    return fallback
  }

  return text.length > 180 ? `${text.slice(0, 180)}…` : text
}

function getSourceValue(entry: EditorSourceChangeEntry, side: 'before' | 'after', language: SourceLanguageKey): string | null {
  if (side === 'before') {
    return {
      cnS: entry.beforeCnS,
      en: entry.beforeEn,
      jp: entry.beforeJp,
      cnT: entry.beforeCnT
    }[language]
  }

  return {
    cnS: entry.afterCnS,
    en: entry.afterEn,
    jp: entry.afterJp,
    cnT: entry.afterCnT
  }[language]
}

function sourcePreview(entry: EditorSourceChangeEntry, side: 'before' | 'after'): string {
  const firstValue = sourceLanguageItems
    .map(language => ({ label: language.label, value: getSourceValue(entry, side, language.key) }))
    .find(language => Boolean(language.value?.trim()))

  return firstValue ? `${firstValue.label} · ${previewText(firstValue.value)}` : '없음'
}

function openTranslationDetail(entry: EditorTranslationLogEntry) {
  selectedTranslation.value = entry
  selectedSource.value = null
  detailOpen.value = true
}

function openSourceDetail(entry: EditorSourceChangeEntry) {
  selectedSource.value = entry
  selectedTranslation.value = null
  detailOpen.value = true
}

async function openSelectedItem() {
  if (!selectedUnitId.value) {
    return
  }

  detailOpen.value = false
  await navigateTo({
    path: '/translate/editor',
    query: {
      itemId: selectedUnitId.value,
      edit: 'true'
    }
  })
}

async function retryActiveLog() {
  if (activeTab.value === 'translations') {
    await refreshTranslations()
    return
  }

  await refreshSourceRevisions()

  if (sourceRevisionId.value) {
    await refreshSourceChanges()
  }
}
</script>

<template>
  <div class="w-full max-w-400 mx-auto px-4 pb-12 md:px-6">
    <div class="flex flex-col gap-5 py-5 md:flex-row md:items-end md:justify-between md:py-8">
      <div>
        <p class="text-xs font-semibold tracking-[0.18em] text-muted">TRANSLATION LOG</p>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">변경 기록</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          사용자가 제안한 번역 수정과 게임 원문이 바뀐 기록을 구분해서 확인할 수 있습니다.
        </p>
      </div>

      <UButton to="/translate/editor" icon="i-tabler-pencil" color="neutral" variant="soft" class="w-fit rounded-xl">
        에디터 열기
      </UButton>
    </div>

    <UTabs :model-value="activeTab" :items="tabItems" color="neutral" variant="link"
      :ui="{ list: 'border-b border-default', trigger: 'px-1.5 pb-3 mr-5' }"
      @update:model-value="updateActiveTab" />

    <section v-if="activeTab === 'translations'" class="mt-6 flex flex-col gap-5">
      <div class="flex flex-col gap-3 rounded-2xl border border-default bg-muted/30 p-4 sm:flex-row sm:items-center">
        <UInput v-model="translationSearchInput" icon="i-tabler-search" color="neutral" variant="soft"
          placeholder="카테고리, 항목, 사용자, 번역 내용 검색" class="w-full sm:flex-1" :ui="{ base: 'rounded-xl' }" />
        <USelect v-model="translationStatusFilter" :items="statusItems" color="neutral" variant="soft"
          class="w-full sm:w-40" :ui="{ base: 'rounded-xl' }" />
      </div>

      <UAlert v-if="translationError" color="error" variant="soft" title="번역 변경 기록을 불러오지 못했습니다."
        description="잠시 후 다시 시도해 주세요.">
        <template #actions>
          <UButton size="sm" color="error" variant="outline" @click="retryActiveLog">다시 시도</UButton>
        </template>
      </UAlert>

      <div class="flex items-center justify-between gap-3 text-sm">
        <span class="rounded-xl bg-muted px-3 py-2 text-muted">총 {{ translationTotal.toLocaleString() }}건</span>
        <span v-if="translationTotal" class="text-xs text-muted">
          {{ translationData?.page ?? translationPage }} / {{ translationTotalPages }} 페이지
        </span>
      </div>

      <UAlert v-if="!translationLoading && !translationEntries.length" color="neutral" variant="soft"
        icon="i-tabler-history-off" title="번역 수정 기록이 없습니다."
        description="검색어나 상태 조건을 바꿔 보거나, 아직 저장된 번역 수정이 없는지 확인해 주세요." />

      <div v-else class="flex flex-col gap-3">
        <article v-for="entry in translationEntries" :key="entry.id" role="button" tabindex="0"
          class="group cursor-pointer rounded-2xl border border-default bg-default p-4 text-left transition-colors hover:border-accented hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-inverted/30"
          @click="openTranslationDetail(entry)" @keydown.enter.prevent="openTranslationDetail(entry)"
          @keydown.space.prevent="openTranslationDetail(entry)">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <UBadge color="neutral" variant="soft">{{ entry.category }}</UBadge>
              <span class="truncate text-sm font-medium">{{ entry.unitKey }}</span>
            </div>
            <UBadge :color="statusColors[entry.status]" variant="soft">
              {{ statusLabels[entry.status] }}
            </UBadge>
          </div>

          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <div class="min-w-0 rounded-xl bg-muted/60 p-3">
              <p class="text-xs font-medium text-muted">수정 전</p>
              <p class="mt-2 whitespace-pre-wrap wrap-break-word text-sm leading-6">{{ previewText(entry.previousText, '미번역') }}</p>
            </div>
            <div class="min-w-0 rounded-xl bg-muted/60 p-3">
              <p class="text-xs font-medium text-muted">수정 후</p>
              <p class="mt-2 whitespace-pre-wrap wrap-break-word text-sm leading-6">{{ previewText(entry.proposedText) }}</p>
            </div>
          </div>

          <div class="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
            <span class="flex min-w-0 items-center gap-1">
              <NuxtLink v-if="getTranslationHandle(entry)" :to="getUserPath(getTranslationHandle(entry))"
                class="hover:underline underline-offset-2"
                :class="hasUserRoleIcon(entry.actorRole) ? '-mt-0.5' : ''" @click.stop>
                {{ formatHandle(getTranslationHandle(entry)) }}
              </NuxtLink>
              <span v-else>알 수 없는 사용자</span>
              <AppUserRoleIcon :role="entry.actorRole" icon-class="size-3.5" />
              <span aria-hidden="true">·</span>
              <span>{{ formatDate(entry.createdAt) }}</span>
            </span>
            <span class="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
              상세 보기 <UIcon name="i-tabler-arrow-up-right" class="size-4" />
            </span>
          </div>
        </article>
      </div>

      <div v-if="translationTotal" class="flex justify-center pt-2">
        <UPagination v-model:page="translationPage" :total="translationTotal"
          :items-per-page="translationData?.pageSize ?? LOG_PAGE_SIZE" :disabled="translationLoading" />
      </div>
    </section>

    <section v-else class="mt-6 flex flex-col gap-5">
      <div class="flex flex-col gap-3 rounded-2xl border border-default bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="text-sm font-medium">게임 원문 변경</p>
          <p class="mt-1 text-xs text-muted">Bot이 감지한 원문 변경만 표시합니다.</p>
        </div>
        <USelect :model-value="sourceRevisionId" :items="sourceRevisionItems" color="neutral" variant="soft"
          class="w-full sm:w-72" :disabled="!sourceRevisionItems.length" :ui="{ base: 'rounded-xl' }"
          @update:model-value="selectSourceRevision" />
      </div>

      <UAlert v-if="sourceRevisionError || sourceChangesError" color="error" variant="soft"
        title="원문 변경 기록을 불러오지 못했습니다." description="잠시 후 다시 시도해 주세요.">
        <template #actions>
          <UButton size="sm" color="error" variant="outline" @click="retryActiveLog">다시 시도</UButton>
        </template>
      </UAlert>

      <div v-if="selectedRevision" class="flex flex-col gap-4 rounded-2xl border border-default p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="font-semibold">v{{ selectedRevision.gameVersion }} · revision {{ selectedRevision.revision }}</p>
          <p class="mt-1 text-xs text-muted">감지 시각 {{ formatDate(selectedRevision.detectedAt) }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UBadge color="success" variant="soft">추가 {{ selectedRevision.addedCount }}</UBadge>
          <UBadge color="warning" variant="soft">수정 {{ selectedRevision.modifiedCount }}</UBadge>
          <UBadge color="error" variant="soft">삭제 {{ selectedRevision.removedCount }}</UBadge>
        </div>
      </div>

      <UAlert v-if="!sourceLoading && !sourceRevisions.length" color="neutral" variant="soft"
        icon="i-tabler-file-off" title="원문 변경 기록이 없습니다."
        description="Bot이 감지한 원문 변경이 아직 등록되지 않았습니다." />

      <UAlert v-else-if="!sourceLoading && sourceRevisionId && !sourceEntries.length" color="neutral" variant="soft"
        icon="i-tabler-file-search" title="선택한 버전에 변경 항목이 없습니다."
        description="다른 버전·리비전을 선택해 보세요." />

      <div v-else class="flex flex-col gap-3">
        <article v-for="entry in sourceEntries" :key="entry.id" role="button" tabindex="0"
          class="group cursor-pointer rounded-2xl border border-default bg-default p-4 text-left transition-colors hover:border-accented hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-inverted/30"
          @click="openSourceDetail(entry)" @keydown.enter.prevent="openSourceDetail(entry)"
          @keydown.space.prevent="openSourceDetail(entry)">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <UBadge color="neutral" variant="soft">{{ entry.category }}</UBadge>
              <span class="truncate text-sm font-medium">{{ entry.unitKey }}</span>
            </div>
            <UBadge :color="sourceChangeColors[entry.changeType]" variant="soft">
              {{ sourceChangeLabels[entry.changeType] }}
            </UBadge>
          </div>

          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <div class="min-w-0 rounded-xl bg-muted/60 p-3">
              <p class="text-xs font-medium text-muted">변경 전</p>
              <p class="mt-2 whitespace-pre-wrap wrap-break-word text-sm leading-6">{{ sourcePreview(entry, 'before') }}</p>
            </div>
            <div class="min-w-0 rounded-xl bg-muted/60 p-3">
              <p class="text-xs font-medium text-muted">변경 후</p>
              <p class="mt-2 whitespace-pre-wrap wrap-break-word text-sm leading-6">{{ sourcePreview(entry, 'after') }}</p>
            </div>
          </div>

          <div class="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
            <span class="flex items-center gap-1">
              <NuxtLink :to="getUserPath(BOT_HANDLE)" class="-mt-0.5 hover:underline underline-offset-2" @click.stop>
                {{ formatHandle(BOT_HANDLE) }}
              </NuxtLink>
              <AppUserRoleIcon role="bot" icon-class="size-3.5" />
              <span>이 감지한 원문 변경 · {{ formatDate(entry.createdAt) }}</span>
            </span>
            <span class="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
              상세 보기 <UIcon name="i-tabler-arrow-up-right" class="size-4" />
            </span>
          </div>
        </article>
      </div>

      <div v-if="sourceTotal" class="flex justify-center pt-2">
        <UPagination v-model:page="sourcePage" :total="sourceTotal"
          :items-per-page="sourceChangesData?.pageSize ?? LOG_PAGE_SIZE" :disabled="sourceLoading" />
      </div>
    </section>

    <USlideover v-model:open="detailOpen" side="right" inset :ui="{ content: 'max-w-2xl' }">
      <template #content>
        <div class="flex h-full flex-col">
          <div class="flex items-start justify-between gap-4 border-b border-default px-5 py-4">
            <div>
              <p class="text-xs font-medium text-muted">항목 상세</p>
              <h2 class="mt-1 text-lg font-semibold">
                {{ selectedTranslation?.unitKey ?? selectedSource?.unitKey }}
              </h2>
            </div>
            <UButton icon="i-tabler-x" color="neutral" variant="ghost" aria-label="닫기"
              class="rounded-xl" @click="detailOpen = false" />
          </div>

          <div class="flex-1 overflow-y-auto p-5">
            <template v-if="selectedTranslation">
              <div class="flex flex-wrap items-center gap-2">
                <UBadge color="neutral" variant="soft">{{ selectedTranslation.category }}</UBadge>
                <UBadge :color="statusColors[selectedTranslation.status]" variant="soft">
                  {{ statusLabels[selectedTranslation.status] }}
                </UBadge>
              </div>

              <div class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span class="flex items-center gap-1">
                  <NuxtLink v-if="getTranslationHandle(selectedTranslation)"
                    :to="getUserPath(getTranslationHandle(selectedTranslation))"
                    class="hover:underline underline-offset-2"
                    :class="hasUserRoleIcon(selectedTranslation.actorRole) ? '-mt-0.5' : ''" @click.stop>
                    {{ formatHandle(getTranslationHandle(selectedTranslation)) }}
                  </NuxtLink>
                  <span v-else>알 수 없는 사용자</span>
                  <AppUserRoleIcon :role="selectedTranslation.actorRole" icon-class="size-4" />
                </span>
                <span>{{ formatDate(selectedTranslation.createdAt) }}</span>
                <span v-if="selectedTranslation.reviewedAt">검토 {{ formatDate(selectedTranslation.reviewedAt) }}</span>
              </div>

              <div class="mt-6 grid gap-4">
                <div>
                  <p class="mb-2 text-xs font-medium text-muted">수정 전</p>
                  <p class="whitespace-pre-wrap wrap-break-word rounded-xl bg-muted p-4 text-sm leading-6">
                    {{ selectedTranslation.previousText || '미번역' }}
                  </p>
                </div>
                <div>
                  <p class="mb-2 text-xs font-medium text-muted">수정 후</p>
                  <p class="whitespace-pre-wrap wrap-break-word rounded-xl bg-muted p-4 text-sm leading-6">
                    {{ selectedTranslation.proposedText }}
                  </p>
                </div>
              </div>
            </template>

            <template v-else-if="selectedSource">
              <div class="flex flex-wrap items-center gap-2">
                <UBadge color="neutral" variant="soft">{{ selectedSource.category }}</UBadge>
                <UBadge :color="sourceChangeColors[selectedSource.changeType]" variant="soft">
                  {{ sourceChangeLabels[selectedSource.changeType] }}
                </UBadge>
              </div>

              <div class="mt-4 flex items-center gap-1 text-sm text-muted">
                <NuxtLink :to="getUserPath(BOT_HANDLE)" class="-mt-0.5 hover:underline underline-offset-2" @click.stop>
                  {{ formatHandle(BOT_HANDLE) }}
                </NuxtLink>
                <AppUserRoleIcon role="bot" />
                <span>이 감지한 원문 변경 · {{ formatDate(selectedSource.createdAt) }}</span>
              </div>

              <div class="mt-6 flex flex-col gap-4">
                <div v-for="language in sourceLanguageItems" :key="language.key" class="rounded-xl border border-default p-4">
                  <p class="text-sm font-semibold">{{ language.label }}</p>
                  <div class="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p class="text-xs font-medium text-muted">변경 전</p>
                      <p class="mt-1 whitespace-pre-wrap wrap-break-word text-sm leading-6">{{ getSourceValue(selectedSource, 'before', language.key) || '없음' }}</p>
                    </div>
                    <div>
                      <p class="text-xs font-medium text-muted">변경 후</p>
                      <p class="mt-1 whitespace-pre-wrap wrap-break-word text-sm leading-6">{{ getSourceValue(selectedSource, 'after', language.key) || '없음' }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div class="border-t border-default p-5">
            <UButton block icon="i-tabler-edit" color="info" variant="soft" class="rounded-xl"
              :disabled="!selectedUnitId" @click="openSelectedItem">
              {{ loggedIn ? '에디터에서 수정' : '에디터에서 항목 보기' }}
            </UButton>
          </div>
        </div>
      </template>
    </USlideover>

    <div v-if="activeLoading" class="fixed inset-0 z-[100] flex items-center justify-center bg-default/30 backdrop-blur-sm"
      role="status" aria-live="polite" aria-label="변경 기록을 불러오는 중">
      <UIcon name="i-tabler-loader-2" class="size-10 animate-spin text-default" />
      <span class="sr-only">변경 기록을 불러오는 중입니다.</span>
    </div>
  </div>
</template>
