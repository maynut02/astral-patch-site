<script setup lang="ts">
import type { EditorDiffMode, EditorItem, EditorItemsResponse, EditorLanguage } from '#shared/types/editor'
import {
  EDITOR_PROGRESS_STATUSES,
  type EditorOverviewResponse,
  type EditorProgressCounts,
  type EditorProgressStatus,
  type EditorProgressSummary
} from '#shared/types/editor-overview'

type EditorItemStatus = EditorProgressStatus
type EditorListMode = 'category' | 'version'
type SidebarMenu = 'list' | 'changes' | 'history' | 'comments' | 'dictionary' | 'settings'

interface SidebarMenuItem {
  key: SidebarMenu
  label: string
  icon: string
}

interface SidebarListRow {
  key: string
  label: string
  path: string
  mode: EditorListMode
  value: string
  total: number
  counts: EditorProgressCounts
}

interface PersistedItemState {
  ko: string
  pendingStatus: EditorItem['pendingStatus']
  approvedForCurrentSource: EditorItem['approvedForCurrentSource']
}

definePageMeta({
  layout: false
})

const isSidebarOpen = ref(true)
const activeSidebarMenu = ref<SidebarMenu>('list')
const page = ref(1)
const pageInput = ref('1')
const pagePopoverOpen = ref(false)
const searchInput = ref('')
const search = ref('')
const sidebarListMode = ref<EditorListMode>('category')
const sidebarListSearch = ref('')
const selectedItemId = ref<string | null>(null)
const historyReloadKey = ref(0)
const selectFirstItemOnNextLoad = ref(false)
const listContainer = ref<HTMLElement | null>(null)
const scrollAfterLoad = ref(false)

const route = useRoute()
const router = useRouter()

const defaultItems: EditorItemsResponse = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 50,
  totalPages: 1
}

function createEmptyProgress(): EditorProgressSummary {
  return {
    total: 0,
    success: 0,
    info: 0,
    warning: 0,
    untranslated: 0
  }
}

const defaultOverview: EditorOverviewResponse = {
  overall: createEmptyProgress(),
  categories: [],
  versions: []
}

const sourceLanguageItems: { key: EditorLanguage, label: string }[] = [
  { key: 'cnS', label: '중국어 간체' },
  { key: 'en', label: '영어' },
  { key: 'jp', label: '일본어' },
  { key: 'cnT', label: '중국어 번체' }
]

const displayLanguageOptions: { key: EditorLanguage, label: string }[] = [
  { key: 'cnS', label: '중국어 간체' },
  { key: 'en', label: '영어' },
  { key: 'jp', label: '일본어' },
  { key: 'cnT', label: '중국어 번체' }
]

const displayLanguages = ref<EditorLanguage[]>(displayLanguageOptions.map(language => language.key))
const languageStorageKey = 'astral-editor-languages'
const languagePreferencesReady = ref(false)
const diffModeOptions: { key: EditorDiffMode, label: string, description: string }[] = [
  { key: 'unified', label: '통합 비교', description: '변경 전·후를 한 줄에서 비교' },
  { key: 'split', label: '분할 비교', description: '변경 전·후를 각각 표시' }
]
const diffMode = ref<EditorDiffMode>('unified')
const diffModeStorageKey = 'astral-editor-diff-mode'
const diffModePreferencesReady = ref(false)

function isEditorLanguage(value: unknown): value is EditorLanguage {
  return value === 'cnS' || value === 'en' || value === 'jp' || value === 'cnT'
}

function isEditorDiffMode(value: unknown): value is EditorDiffMode {
  return value === 'unified' || value === 'split'
}

const visibleSourceLanguageItems = computed(() => sourceLanguageItems.filter(language =>
  displayLanguages.value.includes(language.key)
))

const sidebarMenuItems: SidebarMenuItem[] = [
  { key: 'list', label: '목록', icon: 'i-tabler-list-search' },
  { key: 'history', label: '변경 기록', icon: 'i-tabler-history-toggle' },
  { key: 'comments', label: '코멘트', icon: 'i-tabler-message' },
  { key: 'dictionary', label: '사전', icon: 'i-tabler-book' },
  { key: 'settings', label: '에디터 설정', icon: 'i-tabler-settings' }
]

const activeSidebarMenuItem = computed<SidebarMenuItem>(() =>
  sidebarMenuItems.find(item => item.key === activeSidebarMenu.value) ?? sidebarMenuItems[0]!
)

const itemStatusMeta: Record<EditorItemStatus, { label: string, color: string, textColor: string }> = {
  success: {
    label: '번역 완료',
    color: 'bg-[#81C995]',
    textColor: 'text-[#81C995]'
  },
  info: {
    label: '승인 대기',
    color: 'bg-[#8AB4F8]',
    textColor: 'text-[#8AB4F8]'
  },
  warning: {
    label: '확인 필요',
    color: 'bg-[#FDD663]',
    textColor: 'text-[#FDD663]'
  },
  untranslated: {
    label: '미번역',
    color: 'bg-[#F28B82]',
    textColor: 'text-[#F28B82]'
  }
}

function getQueryString(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

onMounted(() => {
  const storedLanguages = window.localStorage.getItem(languageStorageKey)
  const storedDiffMode = window.localStorage.getItem(diffModeStorageKey)

  if (storedLanguages) {
    try {
      const parsedLanguages: unknown = JSON.parse(storedLanguages)

      if (Array.isArray(parsedLanguages) && parsedLanguages.every(isEditorLanguage)) {
        displayLanguages.value = parsedLanguages
      }
    } catch {
      // 저장된 설정이 손상된 경우 기본 언어를 사용한다.
    }
  }

  if (storedDiffMode && isEditorDiffMode(storedDiffMode)) {
    diffMode.value = storedDiffMode
  }

  languagePreferencesReady.value = true
  diffModePreferencesReady.value = true
})

watch(displayLanguages, (languages) => {
  if (!languagePreferencesReady.value || !import.meta.client) {
    return
  }

  window.localStorage.setItem(languageStorageKey, JSON.stringify(languages))
}, { deep: true })

watch(diffMode, (mode) => {
  if (!diffModePreferencesReady.value || !import.meta.client) {
    return
  }

  window.localStorage.setItem(diffModeStorageKey, mode)
})

const initialSearch = getQueryString(route.query.search).trim()
searchInput.value = initialSearch
search.value = initialSearch

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '')
}

function normalizeRevision(value: string): string {
  return value.trim().replace(/^r/i, '')
}

const category = computed(() => getQueryString(route.query.file).trim())
const version = computed(() => normalizeVersion(getQueryString(route.query.version)))
const revision = computed(() => normalizeRevision(getQueryString(route.query.revision)))
const isFileMode = computed(() => Boolean(category.value))
const isTagMode = computed(() => Boolean(version.value && revision.value))
const isAllMode = computed(() => !isFileMode.value && !isTagMode.value)

watch([isFileMode, isTagMode], ([fileMode, tagMode]) => {
  if (fileMode) {
    sidebarListMode.value = 'category'
  } else if (tagMode) {
    sidebarListMode.value = 'version'
  }
}, { immediate: true })

const headerTitle = computed(() => {
  if (isFileMode.value) {
    return category.value
  }

  if (isTagMode.value) {
    return `v${version.value} · r${revision.value}`
  }

  return '전체 번역'
})

const activeFilterTags = computed(() => search.value
  ? [{ key: 'search', label: '검색', value: search.value }]
  : [])

const backPath = computed(() => {
  const query = new URLSearchParams()

  if (isFileMode.value) {
    query.set('view', 'category')
    query.set('file', category.value)
  } else if (isTagMode.value) {
    query.set('view', 'version')
    query.set('version', version.value)
    query.set('revision', revision.value)
  }

  const queryString = query.toString()
  return queryString ? `/translate?${queryString}` : '/translate'
})

function getVersionLabel(versionValue: string, revisionValue: string): string {
  return `v${normalizeVersion(versionValue)} · r${normalizeRevision(revisionValue)}`
}

function getCategoryPath(categoryValue: string): string {
  return `/translate/editor?file=${encodeURIComponent(categoryValue)}`
}

function getVersionPath(versionValue: string, revisionValue: string): string {
  return `/translate/editor?version=${encodeURIComponent(normalizeVersion(versionValue))}&revision=${encodeURIComponent(normalizeRevision(revisionValue))}`
}

const requestQuery = computed(() => ({
  page: page.value,
  search: search.value || undefined,
  category: isFileMode.value ? category.value : undefined,
  version: isTagMode.value ? version.value : undefined,
  revision: isTagMode.value ? revision.value : undefined
}))

const {
  data: itemsData,
  error: itemsError,
  status: itemsStatus,
  refresh: refreshItems
} = await useFetch<EditorItemsResponse>('/api/editor/items', {
  query: requestQuery,
  default: () => defaultItems,
  server: false,
  watch: [requestQuery]
})

const {
  data: overviewData,
  status: overviewStatus,
  error: overviewError,
  refresh: refreshOverview
} = await useFetch<EditorOverviewResponse>('/api/editor/overview', {
  server: false,
  lazy: true,
  default: () => defaultOverview
})

const items = computed(() => itemsData.value?.items ?? [])
const selectedItemKey = computed(() => {
  const item = items.value.find(item => item.id === selectedItemId.value)
  return item ? `${item.category}_${item.unitKey}` : ''
})
const total = computed(() => itemsData.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, itemsData.value?.totalPages ?? 1))
const isLoading = computed(() => itemsStatus.value === 'idle' || itemsStatus.value === 'pending')
const overview = computed(() => overviewData.value ?? defaultOverview)
const isSidebarListLoading = computed(() => overviewStatus.value === 'idle' || overviewStatus.value === 'pending')
const sidebarListHasError = computed(() => Boolean(overviewError.value))
const persistedItemStates = ref<Record<string, PersistedItemState>>({})
const selectedItemStatus = computed(() => {
  const item = items.value.find(item => item.id === selectedItemId.value)
  return item ? getItemStatus(item) : null
})
const selectedItemStatusMeta = computed(() => selectedItemStatus.value
  ? itemStatusMeta[selectedItemStatus.value]
  : null)

const sidebarCategoryRows = computed<SidebarListRow[]>(() => {
  const query = sidebarListSearch.value.trim().toLowerCase()

  return overview.value.categories
    .filter(item => !query || item.category.toLowerCase().includes(query))
    .map(item => ({
      key: `category:${item.category}`,
      label: item.category,
      path: getCategoryPath(item.category),
      mode: 'category',
      value: item.category,
      total: item.total,
      counts: item.counts
    }))
})

const sidebarVersionRows = computed<SidebarListRow[]>(() => {
  const query = sidebarListSearch.value.trim().toLowerCase()

  return overview.value.versions
    .filter(item => !query || getVersionLabel(item.version, item.revision).toLowerCase().includes(query))
    .map(item => ({
      key: `version:${item.id}`,
      label: getVersionLabel(item.version, item.revision),
      path: getVersionPath(item.version, item.revision),
      mode: 'version',
      value: `${normalizeVersion(item.version)}:${normalizeRevision(item.revision)}`,
      total: item.total,
      counts: item.counts
    }))
})

const sidebarListRows = computed(() => sidebarListMode.value === 'category'
  ? sidebarCategoryRows.value
  : sidebarVersionRows.value)

const sidebarListHasRows = computed(() => sidebarListMode.value === 'category'
  ? overview.value.categories.length > 0
  : overview.value.versions.length > 0)

watch(itemsData, (data) => {
  if (!data) {
    return
  }

  const nextStates = { ...persistedItemStates.value }

  for (const item of data.items) {
    nextStates[item.id] = {
      ko: item.ko,
      pendingStatus: item.pendingStatus,
      approvedForCurrentSource: item.approvedForCurrentSource
    }
  }

  persistedItemStates.value = nextStates
}, { immediate: true })

const currentProgress = computed<EditorProgressSummary>(() => {
  if (isFileMode.value) {
    const categoryProgress = overview.value.categories.find(item => item.category === category.value)

    return categoryProgress
      ? { total: categoryProgress.total, ...categoryProgress.counts }
      : createEmptyProgress()
  }

  if (isTagMode.value) {
    const versionProgress = overview.value.versions.find(item =>
      normalizeVersion(item.version) === version.value
      && normalizeRevision(item.revision) === revision.value
    )

    return versionProgress
      ? { total: versionProgress.total, ...versionProgress.counts }
      : createEmptyProgress()
  }

  return overview.value.overall
})

function getProgressSegments(progress: EditorProgressSummary) {
  const segments = EDITOR_PROGRESS_STATUSES
    .filter(status => progress[status] > 0)
    .map(status => ({
      status,
      percentage: progress.total > 0 ? (progress[status] / progress.total) * 100 : 0
    }))

  return segments.map((segment, index) => ({
    ...segment,
    isLast: index === segments.length - 1
  }))
}

function formatPercent(count: number, totalCount: number): string {
  if (!totalCount) {
    return '0.0%'
  }

  const percentage = (count / totalCount) * 100

  if (count > 0 && percentage < 0.1) {
    return '<0.1%'
  }

  return `${percentage.toFixed(1)}%`
}

function formatCount(value: number): string {
  return value.toLocaleString('ko-KR')
}

function toggleDisplayLanguage(language: EditorLanguage): void {
  displayLanguages.value = displayLanguages.value.includes(language)
    ? displayLanguages.value.filter(value => value !== language)
    : [...displayLanguages.value, language]
}

function selectSidebarMenu(menu: SidebarMenu): void {
  activeSidebarMenu.value = menu

  if (!isSidebarOpen.value) {
    isSidebarOpen.value = true
  }
}

function isActiveSidebarRow(row: SidebarListRow): boolean {
  if (row.mode === 'category') {
    return isFileMode.value && row.value === category.value
  }

  return isTagMode.value && row.value === `${version.value}:${revision.value}`
}

function scrollListToTop(): void {
  nextTick(() => {
    listContainer.value?.scrollTo({
      top: 0,
      behavior: 'auto'
    })
  })
}

async function applySearch(): Promise<void> {
  const nextSearch = searchInput.value.trim()

  if (nextSearch === search.value && getQueryString(route.query.search).trim() === nextSearch) {
    return
  }

  search.value = nextSearch
  page.value = 1
  scrollAfterLoad.value = true

  await router.push({
    query: {
      ...route.query,
      search: nextSearch || undefined
    }
  })
}

function removeFilterTag(key: string): void {
  if (key !== 'search') {
    return
  }

  searchInput.value = ''
  void applySearch()
}

function getItemStatus(item: EditorItem): EditorItemStatus {
  const persistedState = persistedItemStates.value[item.id] ?? item

  if (persistedState.pendingStatus === 'pending') {
    return 'info'
  }

  if (!persistedState.ko.trim()) {
    return 'untranslated'
  }

  return persistedState.approvedForCurrentSource === true ? 'success' : 'warning'
}

function getItemStatusColor(item: EditorItem): string {
  return itemStatusMeta[getItemStatus(item)].color
}

function getItemStatusLabel(item: EditorItem): string {
  return itemStatusMeta[getItemStatus(item)].label
}

function setPage(nextPage: number): void {
  const targetPage = Math.min(Math.max(Math.trunc(nextPage), 1), totalPages.value)
  pageInput.value = String(targetPage)
  pagePopoverOpen.value = false

  if (targetPage === page.value) {
    return
  }

  selectFirstItemOnNextLoad.value = true
  scrollAfterLoad.value = true
  page.value = targetPage
}

function goToInputPage(): void {
  const requestedPage = Number(pageInput.value)

  if (!Number.isFinite(requestedPage)) {
    pageInput.value = String(page.value)
    pagePopoverOpen.value = false
    return
  }

  setPage(requestedPage)
}

function selectItem(item: EditorItem): void {
  selectedItemId.value = item.id
}

function handleHistoryChanged(): void {
  historyReloadKey.value += 1
  void refreshItems()
  void refreshOverview()
}

watch([search, category, version, revision], () => {
  selectFirstItemOnNextLoad.value = true
  scrollAfterLoad.value = true
  page.value = 1
})

watch(itemsStatus, (status) => {
  if (status === 'success') {
    if (!items.value.length) {
      selectedItemId.value = null
      selectFirstItemOnNextLoad.value = false
    }

    if (scrollAfterLoad.value) {
      scrollAfterLoad.value = false
      scrollListToTop()
    }
  } else if (status === 'error') {
    scrollAfterLoad.value = false
  }
})

watch(page, (value) => {
  pageInput.value = String(value)
  selectFirstItemOnNextLoad.value = true
})

watch(() => route.query.search, (value) => {
  const nextSearch = getQueryString(value).trim()

  if (searchInput.value !== nextSearch) {
    searchInput.value = nextSearch
  }

  if (search.value !== nextSearch) {
    search.value = nextSearch
  }
})

watch(totalPages, (nextTotalPages) => {
  if (page.value > nextTotalPages) {
    page.value = nextTotalPages
  }
})

watch(items, (nextItems) => {
  if (!nextItems.length) {
    if (!selectFirstItemOnNextLoad.value) {
      selectedItemId.value = null
    }

    return
  }

  if (selectFirstItemOnNextLoad.value || !nextItems.some(item => item.id === selectedItemId.value)) {
    selectedItemId.value = nextItems[0]?.id ?? null
    selectFirstItemOnNextLoad.value = false
  }
}, { immediate: true })
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden">
    <header class="flex items-center h-16 px-3 bg-muted border-b border-default shrink-0">
      <UButton :to="backPath" icon="i-tabler-chevron-left" color="neutral" variant="soft" size="xl" class="mr-4" />

      <div class="flex flex-1 flex-col">
        <div class="flex gap-3">
          <h1 class="truncate font-medium" :title="headerTitle">{{ headerTitle }}</h1>
          <!-- 현재 파일/태그 진행도 -->
          <UPopover mode="hover" enable-touch :content="{ side: 'bottom', align: 'center', sideOffset: 8 }">
            <div class="flex items-center">
              <div class="w-20 sm:w-28 h-1.5 flex bg-elevated rounded-xl relative overflow-hidden shrink-0"
                aria-label="현재 번역 진행률" role="img">
                <div class="absolute inset-0 flex">
                  <div v-for="segment in getProgressSegments(currentProgress)" :key="segment.status"
                    class="h-full shrink-0" :class="[
                      itemStatusMeta[segment.status].color,
                      segment.isLast ? '' : 'border-r-2 border-default'
                    ]" :style="{ width: `${segment.percentage}%` }" />
                </div>
              </div>
            </div>

            <template #content>
              <div class="w-64 max-w-[calc(100vw-2rem)] p-3 text-xs">
                <div class="flex items-center justify-between gap-4">
                  <h3 class="min-w-0 truncate text-sm font-semibold">{{ headerTitle }} 진행도</h3>
                  <span class="font-mono text-muted shrink-0">
                    {{ formatPercent(currentProgress.success, currentProgress.total) }}
                  </span>
                </div>

                <div class="mt-3 flex items-center justify-between border-t border-default pt-3">
                  <span class="text-muted">완료 항목</span>
                  <span class="font-mono">
                    {{ formatCount(currentProgress.success) }} / {{ formatCount(currentProgress.total) }}
                  </span>
                </div>

                <div class="mt-3 flex flex-col gap-2 border-t border-default pt-3">
                  <div v-for="status in EDITOR_PROGRESS_STATUSES" :key="status"
                    class="flex items-center justify-between gap-4">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="size-1.5 shrink-0 rounded-full" :class="itemStatusMeta[status].color" />
                      <span class="truncate text-muted">{{ itemStatusMeta[status].label }}</span>
                    </div>
                    <div class="shrink-0 text-right font-mono flex">
                      <span>{{ formatCount(currentProgress[status]) }}</span>
                      <span class="mx-1.5">·</span>
                      <span class="w-10">{{ formatPercent(currentProgress[status], currentProgress.total) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </UPopover>
        </div>

        <span class="text-xs text-muted">{{ formatCount(total) }}개 항목</span>
      </div>

      <div class="flex items-center gap-2">
        <UButton icon="i-tabler-bell" color="neutral" variant="ghost" size="xl"
          :ui="{ leadingIcon: 'size-5', base: 'p-2.5' }" />
        <UButton icon="i-tabler-user" color="neutral" variant="soft" size="xl"
          :ui="{ leadingIcon: 'size-5', base: 'p-2.5' }" />
      </div>
    </header>

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <main class="flex min-h-0 flex-1 flex-col border-r border-default">
        <!-- 툴바 -->
        <div class="flex gap-2 bg-muted border-b border-default p-2 shrink-0">
          <div class="flex flex-1 gap-1 shrink-0">
            <UInput v-model="searchInput" size="lg" color="neutral" variant="ghost" placeholder="검색"
              :ui="{ base: 'px-2', trailing: 'pe-1.5' }" @keydown.enter.prevent="applySearch">
              <template #trailing>
                <UButton icon="i-tabler-search" color="neutral" variant="link" size="md" aria-label="검색"
                  :disabled="searchInput.trim() === search" @click="applySearch" />
              </template>
            </UInput>
            <div class="my-1 border-x border-default mx-1" />
            <UTooltip text="필터" :delay-duration="0">
              <UButton icon="i-tabler-filter" color="neutral" variant="ghost" size="lg"
                class="text-dimmed hover:text-default" />
            </UTooltip>
            <UTooltip text="변경된 항목" :delay-duration="0">
              <UButton icon="i-tabler-switch-2" color="neutral" variant="ghost" size="lg"
                class="text-dimmed hover:text-default" />
            </UTooltip>
          </div>

          <div class="flex gap-2 shrink-0">
            <UTooltip text="저장" :delay-duration="0">
              <UButton icon="i-tabler-device-floppy-filled" color="info" variant="soft" size="lg" />
            </UTooltip>
            <UTooltip text="변경사항 되돌리기" :delay-duration="0">
              <UButton icon="i-tabler-arrow-back-up" color="neutral" variant="ghost" size="lg" />
            </UTooltip>
            <UTooltip text="AI 번역" :delay-duration="0">
              <UButton icon="i-tabler-sparkles-2" color="neutral" variant="ghost" size="lg" />
            </UTooltip>
            <UTooltip text="옵션" :delay-duration="0">
              <UButton icon="i-tabler-dots-vertical" color="neutral" variant="ghost" size="lg" />
            </UTooltip>
          </div>
        </div>

        <!-- 목록 -->
        <div class="relative flex min-h-0 flex-1">
          <div v-if="isLoading" class="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
            <div
              class="flex items-center gap-3 rounded-md bg-elevated/50 backdrop-blur-lg px-3 py-2 text-sm text-muted">
              <UIcon name="i-tabler-loader-2" class="size-4 animate-spin" />
              <span>불러오는 중...</span>
            </div>
          </div>

          <div ref="listContainer" class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-20">
            <div class="flex flex-col bg-muted/60">
              <div v-if="activeFilterTags.length" class="flex flex-wrap items-center gap-2 px-4 pt-3 pb-1">
                <div v-for="tag in activeFilterTags" :key="tag.key"
                  class="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-elevated px-2 py-1">
                  <span class="truncate text-xs">{{ tag.label }}: {{ tag.value }}</span>
                  <UButton icon="i-tabler-x" color="neutral" variant="link" size="xs"
                    class="size-5 justify-center shrink-0 p-0" :aria-label="`${tag.label} 제거`"
                    @click="removeFilterTag(tag.key)" />
                </div>
              </div>
              <div class="flex text-xs font-medium text-muted">
                <span class="flex flex-1 shrink-0 px-5 py-2">원문</span>
                <span class="flex flex-1 shrink-0 px-5 py-2">번역</span>
              </div>
            </div>
            <div v-if="itemsError && !items.length" class="p-5 text-sm text-error">
              항목을 불러오지 못했습니다.
            </div>
            <div v-else-if="!isLoading && !items.length" class="p-5 text-sm text-muted">
              검색 결과가 없습니다.
            </div>
            <template v-else-if="items.length">
              <article v-for="item in items" :key="item.id" class="flex shrink-0 transition-colors duration-150"
                :class="selectedItemId === item.id ? 'bg-elevated/70' : 'odd:bg-muted/60'" @click="selectItem(item)">
                <!-- 원문 -->
                <div class="flex min-w-0 flex-1 shrink-0">
                  <div class="flex shrink-0">
                    <!-- 항목 상태 -->
                    <div class="w-0.5" :class="getItemStatusColor(item)" :title="getItemStatusLabel(item)" />
                  </div>
                  <div class="flex min-w-0 flex-1 flex-col gap-2 py-2.5 pl-4.5 pr-2">
                    <!-- 원문 내용 -->
                    <div v-for="source in visibleSourceLanguageItems" :key="source.key"
                      class="flex flex-col min-w-0 gap-0.5 text-sm">
                      <span class="shrink-0 text-[10px] text-dimmed">{{ source.label }}</span>
                      <p class="min-w-0 whitespace-pre-wrap">{{ item[source.key] || '—' }}</p>
                    </div>

                    <!-- 키 -->
                    <span class="break-all text-xs font-medium text-dimmed">
                      {{ item.category }}_{{ item.unitKey }}
                    </span>
                  </div>
                </div>

                <!-- 번역 -->
                <div class="flex min-w-0 flex-1 shrink-0">
                  <!-- 번역 내용 -->
                  <UTextarea v-model="item.ko" color="neutral" variant="none" autoresize placeholder="미번역"
                    :ui="{ base: 'p-2.5 pl-5  h-full' }" class="w-full min-w-0" @focus="selectItem(item)" />

                  <!-- 변경 상태 -->
                  <div class="flex shrink-0 p-2 pl-0 text-info">
                    <UIcon v-if="item.pendingStatus" name="i-tabler-switch-2" class="size-4" title="수정됨" />
                    <div v-else class="size-4" />
                  </div>
                </div>
              </article>
            </template>
          </div>

          <!-- 컨트롤러 -->
          <div class="flex self-end p-1 bg-elevated/50 backdrop-blur-lg rounded-lg absolute bottom-4 right-4">
            <UPopover v-model:open="pagePopoverOpen" :content="{ align: 'center', side: 'top', sideOffset: 8 }">
              <UButton color="neutral" variant="ghost" size="lg" class="text-muted hover:text-default font-medium">
                <span>{{ page }}</span>
                <span class="text-dimmed">/</span>
                <span>{{ totalPages }}</span>
              </UButton>

              <template #content>
                <div class="flex flex-col gap-2 p-2">
                  <UInput v-model="pageInput" type="number" color="neutral" class="w-18" :min="1" :max="totalPages"
                    aria-label="이동할 페이지"
                    :ui="{ base: '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none' }"
                    @keydown.enter.prevent="goToInputPage" />
                  <div class="flex">
                    <UTooltip text="첫 페이지" :delay-duration="0">
                      <UButton icon="i-tabler-chevrons-left" color="neutral" variant="ghost" size="lg"
                        :disabled="page <= 1" @click="setPage(1)" />
                    </UTooltip>
                    <UTooltip text="마지막 페이지" :delay-duration="0">
                      <UButton icon="i-tabler-chevrons-right" color="neutral" variant="ghost" size="lg"
                        :disabled="page >= totalPages" @click="setPage(totalPages)" />
                    </UTooltip>
                  </div>
                </div>
              </template>
            </UPopover>
            <UTooltip text="이전 페이지" :delay-duration="0">
              <UButton icon="i-tabler-chevron-left" color="neutral" variant="ghost" size="lg" :disabled="page <= 1"
                @click="setPage(page - 1)" />
            </UTooltip>
            <UTooltip text="다음 페이지" :delay-duration="0">
              <UButton icon="i-tabler-chevron-right" color="neutral" variant="ghost" size="lg"
                :disabled="page >= totalPages" @click="setPage(page + 1)" />
            </UTooltip>
          </div>
        </div>
      </main>

      <!-- 사이드바 -->
      <aside class="relative shrink-0 overflow-hidden bg-muted transition-[width] duration-300 ease-in-out"
        :style="{ width: isSidebarOpen ? 'max(25%, 28rem)' : '4rem' }">
        <!-- 사이드바 내용 -->
        <section class="absolute inset-y-0 left-0 flex shrink-0 flex-col border-r border-default transition-opacity"
          :style="{ width: 'calc(max(25vw, 28rem) - 4rem)' }" :class="isSidebarOpen
            ? 'opacity-100 duration-500 ease-out'
            : 'pointer-events-none opacity-0 duration-150 ease-in'">
          <!-- 사이드바 헤더 -->
          <div class="flex items-center gap-2 px-4 pt-4 text-sm font-medium text-muted">
            <UIcon :name="activeSidebarMenuItem.icon" class="size-4" />
            <span>{{ activeSidebarMenuItem.label }}</span>
          </div>

          <template v-if="activeSidebarMenu === 'list'">
            <div class="flex shrink-0 gap-3 border-b border-default p-3">
              <!-- 목록 옵션 -->
              <UTabs v-model="sidebarListMode" :content="false"
                :items="[{ label: '파일', value: 'category' }, { label: '버전', value: 'version' }]" color="neutral"
                size="xs" :ui="{ trigger: 'px-3', list: 'bg-elevated/50' }" class="w-fit" />

              <!-- 파일/버전 검색 -->
              <UInput v-model="sidebarListSearch" icon="i-tabler-search" color="neutral" variant="soft" class="w-full"
                :placeholder="sidebarListMode === 'category' ? '파일 검색' : '버전 검색'"
                :ui="{ trailing: 'pe-1', leadingIcon: 'size-4' }">
                <template v-if="sidebarListSearch.length" #trailing>
                  <UButton color="neutral" variant="link" size="sm" icon="i-tabler-x" aria-label="검색어 지우기"
                    @click="sidebarListSearch = ''" />
                </template>
              </UInput>
            </div>

            <div class="relative min-h-0 flex-1 overflow-y-auto">
              <div v-if="isSidebarListLoading && !sidebarListRows.length"
                class="flex items-center justify-center p-5 text-muted">
                <UIcon name="i-tabler-loader-2" class="size-5 animate-spin" />
              </div>

              <div v-else-if="sidebarListHasError && !sidebarListRows.length" class="p-4 text-sm text-error">
                목록을 불러오지 못했습니다.
              </div>

              <nav v-else class="flex flex-col">
                <!-- 전체 번역 -->
                <NuxtLink to="/translate/editor"
                  class="flex min-w-0 items-center gap-2 border-b border-default px-4 py-2.5 text-sm transition-colors"
                  :class="isAllMode ? 'bg-elevated text-default' : 'text-muted hover:bg-elevated hover:text-default'"
                  title="전체 번역">
                  <UIcon name="i-tabler-language" class="size-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate">전체 번역</span>
                  <span class="shrink-0 font-mono text-xs text-[#81C995]">
                    {{ formatPercent(overview.overall.success, overview.overall.total) }}
                  </span>
                </NuxtLink>

                <div v-if="!sidebarListRows.length" class="p-4 text-sm text-muted">
                  {{ sidebarListHasRows ? '검색 결과가 없습니다.' : sidebarListMode === 'category' ?
                    '등록된 파일이 없습니다.' : '등록된 버전이 없습니다.' }}
                </div>

                <NuxtLink v-for="row in sidebarListRows" :key="row.key" :to="row.path"
                  class="flex min-w-0 items-center gap-2 border-b border-default px-4 py-2.5 text-sm transition-colors"
                  :class="isActiveSidebarRow(row) ? 'bg-elevated text-default' : 'text-muted hover:bg-elevated hover:text-default'"
                  :title="row.label">
                  <UIcon :name="row.mode === 'category' ? 'i-tabler-file-filled' : 'i-tabler-tag-filled'"
                    class="size-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
                  <span class="shrink-0 font-mono text-xs text-[#81C995]">
                    {{ formatPercent(row.counts.success, row.total) }}
                  </span>
                </NuxtLink>
              </nav>
            </div>
          </template>

          <template v-else-if="activeSidebarMenu === 'history'">
            <EditorChangeHistory :item-id="selectedItemId" :item-key="selectedItemKey" :reload-key="historyReloadKey"
              :item-status-label="selectedItemStatusMeta?.label ?? ''"
              :item-status-color="selectedItemStatusMeta?.textColor ?? 'text-muted'" :diff-mode="diffMode"
              @changed="handleHistoryChanged" />
          </template>

          <template v-else-if="activeSidebarMenu === 'settings'">
            <div class="flex flex-col gap-4 p-4">
              <div class="flex flex-col gap-2">
                <p class="text-xs font-medium text-muted">
                  원문 표시 언어
                </p>

                <div class="flex flex-col text-sm">
                  <button v-for="language in displayLanguageOptions" :key="language.key" type="button"
                    class="flex items-center gap-2 rounded-xl py-1 pl-1 transition-colors hover:bg-muted"
                    :class="displayLanguages.includes(language.key) ? 'text-default' : 'text-dimmed hover:text-toned'"
                    :aria-pressed="displayLanguages.includes(language.key)"
                    @click="toggleDisplayLanguage(language.key)">
                    <UIcon v-if="displayLanguages.includes(language.key)" name="i-tabler-check" class="size-4" />
                    <span v-else class="size-4" />
                    <span>{{ language.label }}</span>
                  </button>
                </div>
              </div>

              <div class="flex flex-col gap-2 border-t border-default pt-4">
                <p class="text-xs font-medium text-muted">
                  변경 기록 표시 방식
                </p>

                <div class="flex flex-col text-sm">
                  <button v-for="mode in diffModeOptions" :key="mode.key" type="button"
                    class="flex items-start gap-2 rounded-xl py-1 pl-1 text-left transition-colors hover:bg-muted"
                    :class="diffMode === mode.key ? 'text-default' : 'text-dimmed hover:text-toned'"
                    :aria-pressed="diffMode === mode.key" @click="diffMode = mode.key">
                    <UIcon v-if="diffMode === mode.key" name="i-tabler-check" class="mt-0.5 size-4 shrink-0" />
                    <span v-else class="mt-0.5 size-4 shrink-0" />
                    <span class="min-w-0">
                      <span class="block">{{ mode.label }}</span>
                      <span class="mt-0.5 block text-xs text-dimmed">{{ mode.description }}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <div v-else class="flex flex-1 items-center justify-center p-5 text-center">
            <span class="text-sm text-muted">{{ activeSidebarMenuItem.label }} 기능은 준비 중입니다.</span>
          </div>
        </section>

        <!-- 사이드바 네비게이션 -->
        <nav class="absolute inset-y-0 right-0 z-20 flex w-16 shrink-0 flex-col gap-2 bg-muted p-3">
          <div class="flex flex-1 flex-col gap-2">
            <UTooltip v-for="menu in sidebarMenuItems" :key="menu.key" :text="menu.label" :delay-duration="0"
              :content="{ side: 'left' }">
              <UButton :icon="menu.icon" color="neutral" variant="ghost" size="xl"
                :class="activeSidebarMenu === menu.key ? 'bg-elevated text-default' : 'text-dimmed hover:text-default'"
                :aria-label="menu.label" :aria-current="activeSidebarMenu === menu.key ? 'page' : undefined"
                @click="selectSidebarMenu(menu.key)" />
            </UTooltip>
          </div>

          <UTooltip :text="isSidebarOpen ? '사이드바 닫기' : '사이드바 열기'" :delay-duration="0" :content="{ side: 'left' }">
            <UButton :icon="isSidebarOpen ? 'i-tabler-layout-sidebar-right-filled' : 'i-tabler-layout-sidebar-right'"
              color="neutral" variant="ghost" size="xl"
              :class="isSidebarOpen ? 'text-default' : 'text-dimmed hover:text-default'"
              :aria-label="isSidebarOpen ? '사이드바 닫기' : '사이드바 열기'" :aria-pressed="isSidebarOpen"
              @click="isSidebarOpen = !isSidebarOpen" />
          </UTooltip>
        </nav>
      </aside>
    </div>
  </div>
</template>
