<script setup lang="ts">
import type {
  EditorAiTranslationResponse,
  EditorBatchSaveResponse,
  EditorItem,
  EditorItemStatusFilter,
  EditorItemsResponse,
  EditorLanguage,
  EditorSaveResponse,
  EditorSearchMatch,
  EditorSearchType
} from '#shared/types/editor'
import type {
  EditorDictionary,
  EditorDictionaryEntry
} from '#shared/types/editor-dictionary'
import type {
  EditorOverviewResponse,
  EditorProgressCounts,
  EditorProgressStatus,
  EditorProgressSummary
} from '#shared/types/editor-overview'
import { useEditorDictionaries } from '~/composables/editor-dictionaries'
import { useEditorDraftStorage } from '~/composables/editor-drafts'
import { useEditorPreferences } from '~/composables/editor-preferences'
import {
  EDITOR_DIFF_MODE_OPTIONS,
  EDITOR_SEARCH_MATCH_LABELS,
  EDITOR_SEARCH_MATCH_OPTIONS,
  EDITOR_SEARCH_TYPE_LABELS,
  EDITOR_SEARCH_TYPE_OPTIONS,
  EDITOR_SOURCE_LANGUAGE_OPTIONS
} from '~/utils/editor-options'
import { getTranslationSyntaxWarning } from '~/utils/editor-validation'
import {
  formatEditorCount,
  formatEditorPercent,
  formatEditorVersion,
  getEditorQueryString,
  isEditorSearchMatch,
  isEditorSearchType,
  normalizeEditorHandle,
  normalizeEditorRevision,
  normalizeEditorVersion
} from '~/utils/editor-helpers'
import { getRequestErrorMessage } from '~/utils/request-error'

type EditorItemStatus = EditorProgressStatus
type EditorListMode = 'category' | 'version'
type EditorViewFilter = 'all' | EditorItemStatusFilter | 'changed'
type EditorDictionaryPanelView = 'search' | 'collections'
type EditorDictionaryRequestStatus = 'idle' | 'pending' | 'success' | 'error'
type SidebarMenu = 'list' | 'changes' | 'history' | 'comments' | 'dictionary' | 'settings'
type AstralLinkType = 'Buff' | 'Card'

interface AstralReference {
  type: AstralLinkType
  id: string
  originalText: string
}

interface SidebarMenuItem {
  key: SidebarMenu
  label: string
  icon: string
}

interface EditorViewFilterOption {
  key: EditorViewFilter
  label: string
  disabled?: boolean
}

interface EditorDictionarySearchField {
  label: string
  text: string
}

function getDictionaryOwnerHandle(dictionary: EditorDictionary): string {
  return normalizeEditorHandle(dictionary.ownerHandle)
}

function getDictionaryCreatorHandle(entry: EditorDictionaryEntry): string {
  return normalizeEditorHandle(entry.creatorHandle)
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
const isMobileSidebarOpen = ref(false)
const activeSidebarMenu = ref<SidebarMenu>('history')
const page = ref(1)
const optionsPopoverOpen = ref(false)
const searchInput = ref('')
const search = ref('')
const searchFilterOpen = ref(false)
const searchType = ref<EditorSearchType>('all')
const searchMatch = ref<EditorSearchMatch>('contains')
const viewFilterOpen = ref(false)
const viewFilter = ref<EditorViewFilter>('all')
const sidebarListMode = ref<EditorListMode>('category')
const sidebarListSearch = ref('')
const selectedItemId = ref<string | null>(null)
const dictionarySelection = ref<AstralReference | null>(null)
const dictionaryItem = ref<EditorItem | null>(null)
const dictionaryStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const dictionaryError = ref('')
const dictionaryRequestId = ref(0)
const dictionaryPanelView = ref<EditorDictionaryPanelView>('search')
const dictionarySearchInput = ref('')
const dictionarySearch = ref('')
const dictionarySearchData = ref<EditorItemsResponse>({
  items: [],
  total: 0,
  page: 1,
  pageSize: 50,
  totalPages: 1
})
const expandedDictionarySearchItemId = ref<string | null>(null)
const dictionarySearchStatus = ref<EditorDictionaryRequestStatus>('idle')
const dictionarySearchError = ref('')
const dictionarySearchRequestId = ref(0)
const historyReloadKey = ref(0)
const selectFirstItemOnNextLoad = ref(false)
const listContainer = ref<HTMLElement | null>(null)
const scrollAfterLoad = ref(false)
const isSaving = ref(false)
const isAiTranslating = ref(false)
const retainingItemId = ref<string | null>(null)

const route = useRoute()
const router = useRouter()
const { loggedIn } = useUserSession()
const { showToast, showLoginRequiredToast } = useAppToast()
const {
  dictionaries,
  dictionariesStatus,
  dictionariesError,
  selectedDictionaryId,
  selectedDictionary,
  dictionaryEntries,
  dictionaryEntriesStatus,
  dictionaryEntriesError,
  dictionaryEntriesSearchInput,
  dictionaryEntriesSearch,
  dictionaryEntryItems,
  dictionaryModalOpen,
  dictionaryEntryModalOpen,
  dictionaryModalSaving,
  dictionaryEntryModalSaving,
  dictionaryModalError,
  dictionaryEntryModalError,
  dictionaryForm,
  dictionaryEntryForm,
  loadDictionaries,
  selectDictionary,
  runDictionaryEntrySearch,
  openCreateDictionary,
  createDictionary,
  openCreateDictionaryEntry,
  createDictionaryEntry
} = useEditorDictionaries()

const draftStorageKey = 'astral-editor-translation-drafts-v1'
const {
  drafts,
  draftsReady,
  loadDrafts,
  applyDraftsToItems,
  hasItemDraft,
  removeDraftsByKeys,
  getDraftKey
} = useEditorDraftStorage(draftStorageKey)

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

const sourceLanguageItems = EDITOR_SOURCE_LANGUAGE_OPTIONS
const displayLanguageOptions = EDITOR_SOURCE_LANGUAGE_OPTIONS
const searchTypeOptions = EDITOR_SEARCH_TYPE_OPTIONS
const searchMatchOptions = EDITOR_SEARCH_MATCH_OPTIONS
const diffModeOptions = EDITOR_DIFF_MODE_OPTIONS
const searchTypeLabels = EDITOR_SEARCH_TYPE_LABELS
const searchMatchLabels = EDITOR_SEARCH_MATCH_LABELS

const viewFilterOptions: EditorViewFilterOption[] = [
  { key: 'all', label: '전체' },
  { key: 'changed', label: '변경된 항목만' },
  { key: 'untranslated', label: '미번역 항목만' },
  { key: 'pending', label: '승인 대기 항목만' },
  { key: 'warning', label: '확인 필요 항목만' }
]

const dictionaryPanelTabs = [
  { label: '검색', value: 'search' as EditorDictionaryPanelView },
  { label: '용어집', value: 'collections' as EditorDictionaryPanelView }
]

const viewFilterLabels: Record<EditorViewFilter, string> = {
  all: '전체',
  changed: '변경된 항목만',
  untranslated: '미번역 항목만',
  pending: '승인 대기 항목만',
  warning: '확인 필요 항목만'
}

const { displayLanguages, diffMode } = useEditorPreferences()
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

function getItemDraftKey(item: Pick<EditorItem, 'id'>): string {
  return getDraftKey(item.id)
}

// 저장된 임시 번역을 현재 페이지 항목에 복원한다.
onMounted(() => {
  loadDrafts()
  applyDraftsToItems(items.value)
})

const initialSearch = getEditorQueryString(route.query.search).trim()
searchInput.value = initialSearch
search.value = initialSearch
const initialSearchType = getEditorQueryString(route.query.searchType).trim().toLowerCase()
searchType.value = isEditorSearchType(initialSearchType) ? initialSearchType : 'all'
const initialSearchMatch = getEditorQueryString(route.query.match).trim().toLowerCase()
searchMatch.value = isEditorSearchMatch(initialSearchMatch) ? initialSearchMatch : 'contains'

const category = computed(() => getEditorQueryString(route.query.file).trim())
const version = computed(() => normalizeEditorVersion(getEditorQueryString(route.query.version)))
const revision = computed(() => normalizeEditorRevision(getEditorQueryString(route.query.revision)))
const isFileMode = computed(() => Boolean(category.value))
const isTagMode = computed(() => Boolean(version.value && revision.value))
const isAllMode = computed(() => !isFileMode.value && !isTagMode.value)
const changedItemIds = computed(() => {
  const ids = new Set<string>()

  for (const draft of Object.values(drafts.value)) {
    if (!draft.itemId) {
      continue
    }

    if (isFileMode.value && draft.category !== category.value) {
      continue
    }

    ids.add(draft.itemId)
  }

  return [...ids]
})

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

const activeFilterTags = computed(() => {
  const tags: { key: string, label: string, value: string }[] = []

  if (search.value) {
    tags.push({ key: 'search', label: '검색', value: search.value })
  }

  if (searchType.value !== 'all') {
    tags.push({ key: 'searchType', label: '검색 범위', value: searchTypeLabels[searchType.value] })
  }

  if (searchMatch.value === 'exact') {
    tags.push({ key: 'searchMatch', label: '검색 옵션', value: searchMatchLabels[searchMatch.value] })
  }

  if (viewFilter.value !== 'all') {
    tags.push({ key: 'viewFilter', label: '보기 설정', value: viewFilterLabels[viewFilter.value] })
  }

  return tags
})

const isSearchFilterActive = computed(() => searchType.value !== 'all' || searchMatch.value !== 'contains')
const isViewFilterActive = computed(() => viewFilter.value !== 'all')

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

function getCategoryPath(categoryValue: string): string {
  return `/translate/editor?file=${encodeURIComponent(categoryValue)}`
}

function getVersionPath(versionValue: string, revisionValue: string): string {
  return `/translate/editor?version=${encodeURIComponent(normalizeEditorVersion(versionValue))}&revision=${encodeURIComponent(normalizeEditorRevision(revisionValue))}`
}

const dictionaryNamespace = computed(() => dictionarySelection.value?.type === 'Buff' ? 'STRBuff' : 'STRCard')
const dictionaryKey = computed(() => dictionarySelection.value
  ? `${dictionaryNamespace.value}_${dictionarySelection.value.id}`
  : '')

const dictionarySearchItems = computed(() => dictionarySearchData.value.items)

function getDictionarySearchFields(item: EditorItem): EditorDictionarySearchField[] {
  const query = dictionarySearch.value.trim().toLocaleLowerCase()
  const fields: EditorDictionarySearchField[] = [
    { label: 'Key', text: `${item.category}_${item.unitKey}` },
    ...sourceLanguageItems.map(language => ({
      label: language.label,
      text: item[language.key]
    })),
    { label: '한국어', text: item.ko }
  ]

  return fields.filter(field => field.text && field.text.toLocaleLowerCase().includes(query))
}

function getDictionaryExpandedFields(item: EditorItem): EditorDictionarySearchField[] {
  return [
    ...sourceLanguageItems.map(language => ({
      label: language.label,
      text: item[language.key]
    })),
    { label: '한국어', text: item.ko }
  ]
}

const dictionarySearchRows = computed(() => dictionarySearchItems.value.map(item => ({
  item,
  fields: getDictionarySearchFields(item),
  expandedFields: getDictionaryExpandedFields(item)
})))

function toggleDictionarySearchItem(itemId: string): void {
  expandedDictionarySearchItemId.value = expandedDictionarySearchItemId.value === itemId
    ? null
    : itemId
}

async function runDictionarySearch(): Promise<void> {
  const nextSearch = dictionarySearchInput.value.trim()
  dictionarySearch.value = nextSearch
  expandedDictionarySearchItemId.value = null
  const requestId = ++dictionarySearchRequestId.value

  if (!nextSearch) {
    dictionarySearchData.value = { ...defaultItems }
    dictionarySearchStatus.value = 'idle'
    dictionarySearchError.value = ''
    return
  }

  dictionarySearchStatus.value = 'pending'
  dictionarySearchError.value = ''

  try {
    const response = await $fetch<EditorItemsResponse>('/api/editor/items', {
      query: {
        page: 1,
        search: nextSearch,
        searchType: 'all',
        match: 'contains'
      }
    })

    if (requestId !== dictionarySearchRequestId.value) {
      return
    }

    dictionarySearchData.value = response
    dictionarySearchStatus.value = 'success'
  } catch {
    if (requestId !== dictionarySearchRequestId.value) {
      return
    }

    dictionarySearchData.value = { ...defaultItems }
    dictionarySearchStatus.value = 'error'
    dictionarySearchError.value = '파일 검색 결과를 불러오지 못했습니다.'
  }
}

async function openDictionarySearchItem(item: EditorItem): Promise<void> {
  const key = `${item.category}_${item.unitKey}`
  dictionarySelection.value = null
  isMobileSidebarOpen.value = false
  selectFirstItemOnNextLoad.value = true
  scrollAfterLoad.value = true

  await router.push({
    query: {
      file: item.category,
      search: key,
      searchType: 'key',
      match: 'exact',
      page: '1'
    }
  })
}

async function loadDictionaryItem(selection: AstralReference | null): Promise<void> {
  const requestId = ++dictionaryRequestId.value

  if (!selection) {
    dictionaryItem.value = null
    dictionaryStatus.value = 'idle'
    dictionaryError.value = ''
    return
  }

  dictionaryItem.value = null
  dictionaryStatus.value = 'pending'
  dictionaryError.value = ''

  try {
    const response = await $fetch<EditorItemsResponse>('/api/editor/items', {
      query: {
        page: 1,
        category: dictionaryNamespace.value,
        search: dictionaryKey.value,
        searchType: 'key',
        match: 'exact'
      }
    })

    if (requestId !== dictionaryRequestId.value) {
      return
    }

    dictionaryItem.value = response.items.find(item =>
      item.category === dictionaryNamespace.value
      && item.unitKey === selection.id
    ) ?? null
    dictionaryStatus.value = 'success'
  } catch {
    if (requestId !== dictionaryRequestId.value) {
      return
    }

    dictionaryStatus.value = 'error'
    dictionaryError.value = '사전 항목을 불러오지 못했습니다.'
  }
}

function selectDictionaryReference(reference: AstralReference): void {
  dictionarySelection.value = reference
  activeSidebarMenu.value = 'dictionary'
  isSidebarOpen.value = true

  if (import.meta.client && window.matchMedia('(max-width: 1023px)').matches) {
    isMobileSidebarOpen.value = true
  }
}

async function editDictionaryItem(): Promise<void> {
  const item = dictionaryItem.value

  if (!item) {
    return
  }

  const key = `${item.category}_${item.unitKey}`
  dictionarySelection.value = null
  isMobileSidebarOpen.value = false
  selectFirstItemOnNextLoad.value = true
  scrollAfterLoad.value = true

  await router.push({
    query: {
      file: item.category,
      search: key,
      searchType: 'key',
      match: 'exact',
      page: '1'
    }
  })
}

watch(dictionarySelection, (selection) => {
  void loadDictionaryItem(selection)
})

watch(dictionaryPanelView, (view) => {
  if (view === 'collections' && dictionariesStatus.value !== 'pending') {
    void loadDictionaries()
  }
})

const requestQuery = computed(() => ({
  page: page.value,
  search: search.value || undefined,
  searchType: searchType.value,
  match: searchMatch.value === 'exact' ? 'exact' : undefined,
  status: viewFilter.value !== 'all' && viewFilter.value !== 'changed' ? viewFilter.value : undefined,
  itemIds: viewFilter.value === 'changed'
    ? changedItemIds.value.join(',') || '__none__'
    : undefined,
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
  server: false
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
const selectedItem = computed(() => items.value.find(item => item.id === selectedItemId.value) ?? null)
const selectedItemKey = computed(() => selectedItem.value ? `${selectedItem.value.category}_${selectedItem.value.unitKey}` : '')
const selectedItemHasSource = computed(() => selectedItem.value
  ? [selectedItem.value.cnS, selectedItem.value.en, selectedItem.value.jp, selectedItem.value.cnT]
      .some(text => text.trim())
  : false)
const aiTranslationTooltip = computed(() => {
  if (isAiTranslating.value) {
    return 'AI 번역 중'
  }

  if (!selectedItem.value) {
    return '번역할 항목을 선택해 주세요.'
  }

  return selectedItemHasSource.value ? 'AI 번역' : '번역할 원문이 없습니다.'
})
const total = computed(() => itemsData.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, itemsData.value?.totalPages ?? 1))
const isLoading = computed(() => itemsStatus.value === 'idle' || itemsStatus.value === 'pending')
const overview = computed(() => overviewData.value ?? defaultOverview)
const isSidebarListLoading = computed(() => overviewStatus.value === 'idle' || overviewStatus.value === 'pending')
const sidebarListHasError = computed(() => Boolean(overviewError.value))
const persistedItemStates = ref<Record<string, PersistedItemState>>({})
const currentPageDrafts = computed(() => items.value.flatMap((item) => {
  const draft = drafts.value[getItemDraftKey(item)]

  return draft ? [{ item, draft }] : []
}))
const currentPageDraftCount = computed(() => currentPageDrafts.value.length)
const selectedItemHasDraft = computed(() => selectedItem.value ? hasItemDraft(selectedItem.value) : false)
const selectedItemStatus = computed(() => selectedItem.value ? getItemStatus(selectedItem.value) : null)
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
    .filter(item => !query || formatEditorVersion(item.version, item.revision).toLowerCase().includes(query))
    .map(item => ({
      key: `version:${item.id}`,
      label: formatEditorVersion(item.version, item.revision),
      path: getVersionPath(item.version, item.revision),
      mode: 'version',
      value: `${normalizeEditorVersion(item.version)}:${normalizeEditorRevision(item.revision)}`,
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
  applyDraftsToItems(data.items)
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
      normalizeEditorVersion(item.version) === version.value
      && normalizeEditorRevision(item.revision) === revision.value
    )

    return versionProgress
      ? { total: versionProgress.total, ...versionProgress.counts }
      : createEmptyProgress()
  }

  return overview.value.overall
})

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

  if (nextSearch === search.value && getEditorQueryString(route.query.search).trim() === nextSearch) {
    return
  }

  search.value = nextSearch
  page.value = 1
  scrollAfterLoad.value = true

  await router.push({
    query: {
      ...route.query,
      search: nextSearch || undefined,
      searchType: nextSearch && searchType.value !== 'all' ? searchType.value : undefined,
      match: searchMatch.value === 'exact' ? 'exact' : undefined
    }
  })
}

async function selectSearchType(nextSearchType: EditorSearchType): Promise<void> {
  searchType.value = nextSearchType
  searchFilterOpen.value = false
  page.value = 1
  scrollAfterLoad.value = true

  await router.push({
    query: {
      ...route.query,
      searchType: nextSearchType === 'all' ? undefined : nextSearchType,
      page: '1'
    }
  })
}

async function selectSearchMatch(nextSearchMatch: EditorSearchMatch): Promise<void> {
  searchMatch.value = nextSearchMatch
  searchFilterOpen.value = false
  page.value = 1
  scrollAfterLoad.value = true

  await router.push({
    query: {
      ...route.query,
      match: nextSearchMatch === 'exact' ? 'exact' : undefined,
      page: '1'
    }
  })
}

function selectViewFilter(nextViewFilter: EditorViewFilter): void {
  viewFilter.value = nextViewFilter
  viewFilterOpen.value = false
  page.value = 1
  selectFirstItemOnNextLoad.value = true
  scrollAfterLoad.value = true
}

function removeFilterTag(key: string): void {
  if (key === 'search') {
    searchInput.value = ''
    void applySearch()
    return
  }

  if (key === 'searchType') {
    searchType.value = 'all'
    page.value = 1
    scrollAfterLoad.value = true
    void router.push({
      query: {
        ...route.query,
        searchType: undefined,
        page: '1'
      }
    })
    return
  }

  if (key === 'searchMatch') {
    searchMatch.value = 'contains'
    page.value = 1
    scrollAfterLoad.value = true
    void router.push({
      query: {
        ...route.query,
        match: undefined,
        page: '1'
      }
    })
    return
  }

  if (key === 'viewFilter') {
    selectViewFilter('all')
  }
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

function canRetainItem(item: EditorItem): boolean {
  return getItemStatus(item) === 'warning' && !hasItemDraft(item)
}

async function retainItemTranslation(item: EditorItem): Promise<void> {
  if (!canRetainItem(item) || retainingItemId.value) {
    return
  }

  if (!loggedIn.value) {
    showLoginRequiredToast('editor-retain-login-required')
    return
  }

  retainingItemId.value = item.id

  try {
    const response = await $fetch<EditorSaveResponse>(
      `/api/editor/items/${encodeURIComponent(item.id)}/retain`,
      { method: 'POST' }
    )

    item.ko = response.ko
    item.pendingStatus = response.status
    persistedItemStates.value = {
      ...persistedItemStates.value,
      [item.id]: {
        ko: response.ko,
        pendingStatus: response.status,
        approvedForCurrentSource: item.approvedForCurrentSource
      }
    }

    await Promise.allSettled([refreshItems(), refreshOverview()])

    if (selectedItemId.value === item.id && activeSidebarMenu.value === 'history') {
      historyReloadKey.value += 1
    }

    showToast({
      id: `editor-retain-${item.id}`,
      title: response.changed ? '현재 번역을 승인 대기로 등록했습니다.' : '이미 같은 내용이 승인 대기 중입니다.'
    })
  } catch (error: unknown) {
    showToast({
      id: `editor-retain-failed-${item.id}`,
      title: '현재 번역을 유지하지 못했습니다.',
      description: getRequestErrorMessage(error, '잠시 후 다시 시도해 주세요.')
    })
  } finally {
    retainingItemId.value = null
  }
}

function selectItem(item: EditorItem): void {
  selectedItemId.value = item.id
}

function removeDraftByKey(key: string): void {
  removeDraftsByKeys([key])
}

function updateItemDraft(item: EditorItem): void {
  if (!draftsReady.value) {
    return
  }

  const key = getItemDraftKey(item)
  const persistedState = persistedItemStates.value[item.id]

  if (persistedState && item.ko === persistedState.ko) {
    removeDraftByKey(key)
    return
  }

  drafts.value = {
    ...drafts.value,
    [key]: {
      category: item.category,
      unitKey: item.unitKey,
      text: item.ko,
      updatedAt: Date.now(),
      itemId: item.id
    }
  }
}

function handleItemTranslationInput(item: EditorItem, value: string): void {
  item.ko = value
  selectItem(item)
  updateItemDraft(item)
}

function getAiTranslationErrorMessage(error: unknown): string {
  return getRequestErrorMessage(error, 'AI 번역에 실패했습니다.')
}

async function translateSelectedItemWithAi(): Promise<void> {
  const item = selectedItem.value

  if (!item || isAiTranslating.value || !selectedItemHasSource.value) {
    return
  }

  if (!loggedIn.value) {
    showLoginRequiredToast('editor-ai-translation-login-required')
    return
  }

  isAiTranslating.value = true

  try {
    const response = await $fetch<EditorAiTranslationResponse>(
      `/api/editor/items/${encodeURIComponent(item.id)}/ai-translation`,
      {
        method: 'POST',
        body: {
          sourceVersionId: item.sourceVersionId
        }
      }
    )
    const translatedText = response.text.trim()

    if (response.itemId !== item.id
      || response.sourceVersionId !== item.sourceVersionId
      || !translatedText) {
      throw new Error('AI 번역 결과가 현재 항목과 일치하지 않습니다.')
    }

    handleItemTranslationInput(item, translatedText)
  } catch (error: unknown) {
    showToast({
      id: 'editor-ai-translation-failed',
      title: 'AI 번역에 실패했습니다.',
      description: getAiTranslationErrorMessage(error)
    })
  } finally {
    isAiTranslating.value = false
  }
}

async function saveCurrentPage(): Promise<void> {
  const entries = currentPageDrafts.value

  if (isSaving.value || !entries.length) {
    return
  }

  if (!loggedIn.value) {
    showLoginRequiredToast('editor-save-login-required')
    return
  }

  if (entries.some(({ draft }) => !draft.text.trim())) {
    showToast({
      id: 'editor-save-empty-translation',
      title: '번역을 저장할 수 없습니다.',
      description: '번역 내용이 비어 있는 항목을 먼저 입력해 주세요.'
    })
    return
  }

  isSaving.value = true

  try {
    const batch = await $fetch<EditorBatchSaveResponse>('/api/editor/items/batch', {
      method: 'PATCH',
      body: {
        items: entries.map(({ item, draft }) => ({
          id: item.id,
          text: draft.text
        }))
      }
    })
    const entriesById = new Map(entries.map(entry => [entry.item.id, entry]))
    const handledItemIds = new Set<string>()
    let savedCount = 0
    let failedCount = 0
    const savedDraftKeys: string[] = []
    const changedItemIds = new Set<string>()

    for (const result of batch.results) {
      const entry = entriesById.get(result.itemId)

      if (!entry || handledItemIds.has(result.itemId)) {
        continue
      }

      handledItemIds.add(result.itemId)

      if (!result.ok || !result.response) {
        failedCount += 1
        continue
      }

      const { item, draft } = entry
      const response = result.response
      const key = getItemDraftKey(item)
      const currentDraft = drafts.value[key]

      if (currentDraft?.text === draft.text) {
        savedDraftKeys.push(key)
      }

      item.ko = response.ko
      item.pendingStatus = response.status

      if (response.changed) {
        changedItemIds.add(item.id)
      }

      const previousState = persistedItemStates.value[item.id]
      persistedItemStates.value = {
        ...persistedItemStates.value,
        [item.id]: {
          ko: response.ko,
          pendingStatus: response.status ?? previousState?.pendingStatus ?? null,
          approvedForCurrentSource: previousState?.approvedForCurrentSource ?? item.approvedForCurrentSource
        }
      }
      savedCount += 1
    }

    failedCount += entries.length - handledItemIds.size
    removeDraftsByKeys(savedDraftKeys)

    await Promise.allSettled([refreshItems(), refreshOverview()])

    if (activeSidebarMenu.value === 'history'
      && selectedItemId.value
      && changedItemIds.has(selectedItemId.value)) {
      historyReloadKey.value += 1
    }

    if (failedCount) {
      showToast({
        id: 'editor-save-partial',
        title: `${savedCount}개 항목을 저장했습니다.`,
        description: `${failedCount}개 항목은 저장하지 못했습니다. 임시저장 상태로 남아 있습니다.`
      })
    } else {
      showToast({
        id: 'editor-save-success',
        title: `${savedCount}개 항목을 저장했습니다.`
      })
    }
  } catch (error: unknown) {
    showToast({
      id: 'editor-save-failed',
      title: '번역을 저장하지 못했습니다.',
      description: getRequestErrorMessage(error, '잠시 후 다시 시도해 주세요.')
    })
  } finally {
    isSaving.value = false
  }
}

function revertSelectedItem(): void {
  const item = items.value.find(item => item.id === selectedItemId.value)

  if (!item) {
    return
  }

  const key = getItemDraftKey(item)
  const draft = drafts.value[key]

  if (!draft) {
    return
  }

  const persistedState = persistedItemStates.value[item.id]
  removeDraftByKey(key)
  item.ko = persistedState?.ko ?? ''
}

async function copySelectedItemLink(): Promise<void> {
  const item = items.value.find(item => item.id === selectedItemId.value)

  if (!item || !import.meta.client) {
    return
  }

  const itemKey = `${item.category}_${item.unitKey}`
  const query: Record<string, string> = {
    search: itemKey,
    searchType: 'key',
    match: 'exact',
    page: '1'
  }

  if (isFileMode.value) {
    query.file = item.category
  } else if (isTagMode.value) {
    query.version = version.value
    query.revision = revision.value
  }

  const resolved = router.resolve({ path: '/translate/editor', query })
  const url = new URL(resolved.href, window.location.origin).toString()

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable')
    }

    await navigator.clipboard.writeText(url)
    showToast({
      id: 'editor-share-link-copied',
      title: '항목 링크를 복사했습니다.'
    })
  } catch {
    showToast({
      id: 'editor-share-link-copy-failed',
      title: '항목 링크를 복사하지 못했습니다.',
      description: '브라우저의 클립보드 권한을 확인해 주세요.'
    })
  } finally {
    optionsPopoverOpen.value = false
  }
}

function revertCurrentPageDrafts(): void {
  const entries = currentPageDrafts.value

  if (!entries.length) {
    return
  }

  removeDraftsByKeys(entries.map(({ item }) => getItemDraftKey(item)))

  for (const { item } of entries) {
    item.ko = persistedItemStates.value[item.id]?.ko ?? ''
  }

  optionsPopoverOpen.value = false
  showToast({
    id: 'editor-page-drafts-reset',
    title: `${entries.length}개 항목의 임시저장을 되돌렸습니다.`
  })
}

function handleHistoryChanged(): void {
  historyReloadKey.value += 1
  void refreshItems()
  void refreshOverview()
}

watch([search, searchType, searchMatch, viewFilter, category, version, revision], () => {
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

watch(page, () => {
  selectFirstItemOnNextLoad.value = true
  scrollAfterLoad.value = true
})

watch(() => route.query.search, (value) => {
  const nextSearch = getEditorQueryString(value).trim()

  if (searchInput.value !== nextSearch) {
    searchInput.value = nextSearch
  }

  if (search.value !== nextSearch) {
    search.value = nextSearch
  }
})

watch(() => route.query.searchType, (value) => {
  const nextSearchType = getEditorQueryString(value).trim().toLowerCase()
  const normalizedSearchType = isEditorSearchType(nextSearchType) ? nextSearchType : 'all'

  if (searchType.value !== normalizedSearchType) {
    searchType.value = normalizedSearchType
  }
})

watch(() => route.query.match, (value) => {
  const nextSearchMatch = getEditorQueryString(value).trim().toLowerCase()
  const normalizedSearchMatch = isEditorSearchMatch(nextSearchMatch) ? nextSearchMatch : 'contains'

  if (searchMatch.value !== normalizedSearchMatch) {
    searchMatch.value = normalizedSearchMatch
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
    <header class="relative z-50 flex h-16 shrink-0 items-center border-b border-default bg-muted px-2 sm:px-3">
      <UButton
        :to="backPath"
        icon="i-tabler-chevron-left"
        color="neutral"
        variant="soft"
        size="lg"
        class="mr-2 sm:mr-4"
        :ui="{ leadingIcon: 'size-5 lg:size-6' }"
      />

      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex min-w-0 items-center gap-2 sm:gap-3">
          <h1
            class="truncate font-medium"
            :title="headerTitle"
          >
            {{ headerTitle }}
          </h1>
          <EditorProgressPopover
            :title="headerTitle"
            :progress="currentProgress"
            :status-meta="itemStatusMeta"
          />
        </div>

        <span class="flex items-center gap-1.5 text-xs text-muted">
          <span>{{ formatEditorCount(total) }}개 항목</span>
          <span class="font-mono text-[#81C995] sm:hidden">
            {{ formatEditorPercent(currentProgress.success, currentProgress.total) }}
          </span>
        </span>
      </div>

      <div class="ml-2 flex shrink-0 items-center">
        <UButton
          icon="i-tabler-bell"
          color="neutral"
          variant="ghost"
          size="lg"
          :ui="{ leadingIcon: 'size-5', base: 'p-2 lg:p-2.5' }"
          class="hidden sm:inline-flex text-muted hover:text-default"
        />
        <AppUserMenu context="editor" />
        <UButton
          :icon="isMobileSidebarOpen ? 'i-tabler-layout-sidebar-right-filled' : 'i-tabler-layout-sidebar-right'"
          color="neutral"
          variant="ghost"
          size="lg"
          class="lg:hidden"
          :class="isMobileSidebarOpen ? 'bg-elevated text-default' : 'text-dimmed hover:text-default'"
          :aria-label="isMobileSidebarOpen ? '사이드바 닫기' : '사이드바 열기'"
          :aria-pressed="isMobileSidebarOpen"
          @click="isMobileSidebarOpen = !isMobileSidebarOpen"
        />
      </div>
    </header>

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <main class="flex min-h-0 min-w-0 flex-1 flex-col lg:border-r lg:border-default">
        <div
          class="flex shrink-0 flex-wrap gap-1.5 border-b border-default bg-muted p-1.5 sm:gap-2 sm:p-2 md:flex-nowrap"
        >
          <div class="flex w-full min-w-0 flex-1 gap-1 md:w-auto">
            <UInput
              v-model="searchInput"
              size="lg"
              color="neutral"
              variant="ghost"
              placeholder="검색"
              class="min-w-0 max-md:flex-1"
              :ui="{ base: 'h-9 leading-5 px-2', trailing: 'pe-1.5' }"
              @keydown.enter.prevent="applySearch"
            >
              <template #trailing>
                <UButton
                  icon="i-tabler-search"
                  color="neutral"
                  variant="link"
                  size="md"
                  aria-label="검색"
                  :disabled="searchInput.trim() === search"
                  @click="applySearch"
                />
              </template>
            </UInput>
            <div class="my-1 border-x border-default mx-1" />
            <UPopover
              v-model:open="searchFilterOpen"
              :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
            >
              <UTooltip
                text="검색 설정"
                :delay-duration="0"
              >
                <div class="relative">
                  <UButton
                    icon="i-tabler-adjustments-horizontal"
                    color="neutral"
                    variant="ghost"
                    size="lg"
                    :class="searchFilterOpen
                      ? 'bg-elevated text-default'
                      : isSearchFilterActive ? 'text-default' : 'text-dimmed hover:text-default'"
                    aria-label="검색 설정"
                  />
                  <span
                    v-if="isSearchFilterActive"
                    class="pointer-events-none absolute right-1.5 top-1.5 size-1.5 rounded-full bg-info ring-1 ring-muted"
                  />
                </div>
              </UTooltip>
              <template #content>
                <div class="flex min-w-40 flex-col p-1.5">
                  <span class="px-2 py-1 text-xs font-medium text-dimmed">검색 범위</span>
                  <button
                    v-for="option in searchTypeOptions"
                    :key="option.key"
                    type="button"
                    class="flex items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    @click="void selectSearchType(option.key)"
                  >
                    <UIcon
                      v-if="searchType === option.key"
                      name="i-tabler-check"
                      class="size-4"
                    />
                    <span
                      v-else
                      class="size-4"
                    />
                    <span>{{ option.label }}</span>
                  </button>

                  <div class="mt-2 border-t border-default pt-2">
                    <span class="px-2 py-1 text-xs font-medium text-dimmed">검색 옵션</span>
                    <button
                      v-for="option in searchMatchOptions"
                      :key="option.key"
                      type="button"
                      class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                      @click="void selectSearchMatch(option.key)"
                    >
                      <UIcon
                        v-if="searchMatch === option.key"
                        name="i-tabler-check"
                        class="size-4"
                      />
                      <span
                        v-else
                        class="size-4"
                      />
                      <span>{{ option.label }}</span>
                    </button>
                  </div>
                </div>
              </template>
            </UPopover>

            <UPopover
              v-model:open="viewFilterOpen"
              :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
            >
              <UTooltip
                text="보기 설정"
                :delay-duration="0"
              >
                <div class="relative">
                  <UButton
                    icon="i-tabler-eye-search"
                    color="neutral"
                    variant="ghost"
                    size="lg"
                    :class="viewFilterOpen
                      ? 'bg-elevated text-default'
                      : isViewFilterActive ? 'text-default' : 'text-dimmed hover:text-default'"
                    aria-label="보기 설정"
                  />
                  <span
                    v-if="isViewFilterActive"
                    class="pointer-events-none absolute right-1.5 top-1.5 size-1.5 rounded-full bg-info ring-1 ring-muted"
                  />
                </div>
              </UTooltip>
              <template #content>
                <div class="flex min-w-40 flex-col p-1.5">
                  <span class="px-2 py-1 text-xs font-medium text-dimmed">보기 설정</span>
                  <button
                    v-for="option in viewFilterOptions"
                    :key="option.key"
                    type="button"
                    :disabled="option.disabled"
                    class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed! disabled:opacity-50"
                    @click="selectViewFilter(option.key)"
                  >
                    <UIcon
                      v-if="viewFilter === option.key"
                      name="i-tabler-check"
                      class="size-4"
                    />
                    <span
                      v-else
                      class="size-4"
                    />
                    <span>{{ option.label }}</span>
                  </button>
                </div>
              </template>
            </UPopover>
          </div>

          <div class="flex w-full shrink-0 justify-end gap-1 sm:gap-2 md:w-auto">
            <UTooltip
              :text="currentPageDraftCount ? `현재 페이지 저장 (${currentPageDraftCount}건)` : '저장'"
              :delay-duration="0"
            >
              <UButton
                icon="i-tabler-device-floppy-filled"
                color="info"
                variant="soft"
                size="lg"
                :loading="isSaving"
                :disabled="!currentPageDraftCount || isSaving"
                @click="saveCurrentPage"
              />
            </UTooltip>
            <UTooltip
              text="변경사항 되돌리기"
              :delay-duration="0"
            >
              <UButton
                icon="i-tabler-arrow-back-up"
                color="neutral"
                variant="ghost"
                size="lg"
                :disabled="!selectedItemHasDraft"
                @click="revertSelectedItem"
              />
            </UTooltip>
            <UTooltip
              :text="aiTranslationTooltip"
              :delay-duration="0"
            >
              <UButton
                icon="i-tabler-sparkles-2"
                color="neutral"
                variant="ghost"
                size="lg"
                aria-label="AI 번역"
                :loading="isAiTranslating"
                :disabled="!selectedItem || !selectedItemHasSource || isAiTranslating || isSaving"
                @click="translateSelectedItemWithAi"
              />
            </UTooltip>
            <UPopover
              v-model:open="optionsPopoverOpen"
              :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
            >
              <UTooltip
                text="옵션"
                :delay-duration="0"
              >
                <UButton
                  icon="i-tabler-dots-vertical"
                  color="neutral"
                  variant="ghost"
                  size="lg"
                  :class="optionsPopoverOpen ? 'bg-elevated text-default' : ''"
                  aria-label="옵션"
                />
              </UTooltip>
              <template #content>
                <div class="flex min-w-56 flex-col p-1.5">
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed! disabled:opacity-50"
                    :disabled="!selectedItemId"
                    @click="void copySelectedItemLink()"
                  >
                    <UIcon
                      name="i-tabler-link"
                      class="size-4 shrink-0"
                    />
                    <span>선택 항목 링크 복사</span>
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed! disabled:opacity-50"
                    :disabled="!currentPageDraftCount"
                    @click="revertCurrentPageDrafts"
                  >
                    <UIcon
                      name="i-tabler-arrow-back-up"
                      class="size-4 shrink-0"
                    />
                    <span>현재 페이지 변경사항 되돌리기</span>
                  </button>
                </div>
              </template>
            </UPopover>
          </div>
        </div>

        <div class="relative flex min-h-0 flex-1">
          <div
            v-if="isLoading"
            class="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center"
          >
            <div
              class="flex items-center gap-3 bg-elevated/50 backdrop-blur-lg px-3 py-2 text-sm text-muted"
            >
              <UIcon
                name="i-tabler-loader-2"
                class="size-4 animate-spin"
              />
              <span>불러오는 중...</span>
            </div>
          </div>

          <div
            ref="listContainer"
            class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-24 lg:pb-20"
          >
            <div class="flex flex-col bg-muted/60">
              <div
                v-if="activeFilterTags.length"
                class="flex flex-wrap items-center gap-2 px-4 pt-3 pb-1"
              >
                <div
                  v-for="tag in activeFilterTags"
                  :key="tag.key"
                  class="flex min-w-0 max-w-full items-center gap-1 bg-elevated px-2 py-1"
                >
                  <span class="truncate text-xs">{{ tag.label }}: {{ tag.value }}</span>
                  <UButton
                    icon="i-tabler-x"
                    color="neutral"
                    variant="link"
                    size="xs"
                    class="size-5 justify-center shrink-0 p-0"
                    :aria-label="`${tag.label} 제거`"
                    @click="removeFilterTag(tag.key)"
                  />
                </div>
              </div>
              <div class="hidden text-xs font-medium text-muted lg:flex">
                <span class="flex flex-1 shrink-0 px-5 py-2">원문</span>
                <span class="flex flex-1 shrink-0 px-5 py-2">한국어 번역</span>
              </div>
            </div>
            <div
              v-if="itemsError && !items.length"
              class="p-5 text-sm text-error"
            >
              항목을 불러오지 못했습니다.
            </div>
            <div
              v-else-if="!isLoading && !items.length"
              class="p-5 text-sm text-muted"
            >
              {{ viewFilter === 'changed' ? '변경된 항목이 없습니다.' : '검색 결과가 없습니다.' }}
            </div>
            <template v-else-if="items.length">
              <article
                v-for="item in items"
                :key="item.id"
                class="flex shrink-0 flex-col border-b border-default transition-colors duration-150 lg:flex-row lg:border-b-0"
                :class="selectedItemId === item.id ? 'bg-elevated/70' : 'odd:bg-muted/40'"
                @click="selectItem(item)"
              >
                <div class="flex min-w-0 w-full shrink-0 lg:flex-1">
                  <div class="flex shrink-0">
                    <div
                      class="w-0.5"
                      :class="getItemStatusColor(item)"
                      :title="getItemStatusLabel(item)"
                    />
                  </div>
                  <div class="flex min-w-0 flex-1 flex-col gap-2 py-3 pl-4.5 pr-3 lg:py-2.5 lg:pr-2">
                    <span class="text-xs font-medium text-muted lg:hidden">원문</span>
                    <div
                      v-for="source in visibleSourceLanguageItems"
                      :key="source.key"
                      class="flex flex-col min-w-0 gap-0.5 text-sm"
                    >
                      <span class="shrink-0 text-[10px] text-dimmed">{{ source.label }}</span>
                      <p class="min-w-0 whitespace-pre-wrap">
                        <EditorSourceText
                          :text="item[source.key] || null"
                          @select="selectDictionaryReference"
                        >
                          <template #empty>
                            —
                          </template>
                        </EditorSourceText>
                      </p>
                    </div>

                    <span class="break-all text-xs font-medium text-dimmed">
                      {{ item.category }}_{{ item.unitKey }}
                    </span>
                  </div>
                </div>

                <div class="relative flex min-w-0 w-full shrink-0 border-t border-default lg:flex-1 lg:border-t-0">
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="px-4 pt-2.5 text-xs font-medium text-muted lg:hidden">한국어 번역</span>
                    <UTextarea
                      :model-value="item.ko"
                      color="neutral"
                      variant="none"
                      autoresize
                      placeholder="미번역"
                      :readonly="!loggedIn"
                      :ui="{ base: 'min-h-24 p-3 pt-1.5 pl-4 pr-10 h-full lg:min-h-0 lg:pt-3 lg:pl-5' }"
                      class="w-full min-w-0"
                      @focus="selectItem(item)"
                      @click="!loggedIn && showLoginRequiredToast('editor-translation-login-required')"
                      @update:model-value="handleItemTranslationInput(item, $event)"
                    />
                  </div>

                  <UIcon
                    v-if="getTranslationSyntaxWarning(item)"
                    name="i-tabler-alert-triangle"
                    class="absolute bottom-2.5 right-2.5 size-4 text-warning"
                    :title="getTranslationSyntaxWarning(item)"
                  />

                  <UButton
                    v-if="canRetainItem(item)"
                    label="유지"
                    icon="i-tabler-check"
                    color="warning"
                    variant="soft"
                    size="xs"
                    class="absolute right-2 top-2 z-10"
                    :loading="retainingItemId === item.id"
                    :disabled="Boolean(retainingItemId) || isSaving"
                    @click.stop="retainItemTranslation(item)"
                  />

                  <UIcon
                    v-if="hasItemDraft(item)"
                    name="i-tabler-switch-2"
                    class="absolute right-2.5 top-2.5 size-4 text-info"
                    title="변경됨"
                  />
                </div>
              </article>
            </template>
          </div>

          <EditorPageController
            v-model:page="page"
            :total-pages="totalPages"
            class="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 self-end lg:left-auto lg:right-4 lg:translate-x-0"
          />
        </div>
      </main>

      <aside
        class="editor-sidebar shrink-0 overflow-hidden bg-muted"
        :class="{ 'editor-sidebar--desktop-open': isSidebarOpen, 'editor-sidebar--mobile-open': isMobileSidebarOpen }"
      >
        <section
          class="editor-sidebar-content absolute inset-x-0 bottom-0 top-14 flex shrink-0 flex-col border-t border-default transition-opacity lg:inset-y-0 lg:left-0 lg:right-auto lg:border-r lg:border-t-0"
          :class="isSidebarOpen || isMobileSidebarOpen
            ? 'opacity-100 duration-500 ease-out'
            : 'pointer-events-none opacity-0 duration-150 ease-in'"
        >
          <div class="flex items-center gap-2 px-4 pt-4 text-sm font-medium text-muted">
            <UIcon
              :name="activeSidebarMenuItem.icon"
              class="size-4"
            />
            <span>{{ activeSidebarMenuItem.label }}</span>
          </div>

          <template v-if="activeSidebarMenu === 'list'">
            <div class="flex shrink-0 flex-col gap-3 border-b border-default p-3 sm:flex-row">
              <UTabs
                v-model="sidebarListMode"
                :content="false"
                :items="[{ label: '파일', value: 'category' }, { label: '버전', value: 'version' }]"
                color="neutral"
                size="xs"
                :ui="{ trigger: 'h-6 px-3 leading-4', list: 'bg-elevated/50' }"
                class="w-fit"
              />

              <UInput
                v-model="sidebarListSearch"
                icon="i-tabler-search"
                color="neutral"
                variant="soft"
                class="w-full min-w-0"
                :placeholder="sidebarListMode === 'category' ? '파일 검색' : '버전 검색'"
                :ui="{ base: 'h-8 leading-5', trailing: 'pe-1', leadingIcon: 'size-4' }"
              >
                <template
                  v-if="sidebarListSearch.length"
                  #trailing
                >
                  <UButton
                    color="neutral"
                    variant="link"
                    size="sm"
                    icon="i-tabler-x"
                    aria-label="검색어 지우기"
                    @click="sidebarListSearch = ''"
                  />
                </template>
              </UInput>
            </div>

            <div class="relative min-h-0 flex-1 overflow-y-auto">
              <div
                v-if="isSidebarListLoading && !sidebarListRows.length"
                class="flex items-center justify-center p-5 text-muted"
              >
                <AppLoadingSpinner />
              </div>

              <div
                v-else-if="sidebarListHasError && !sidebarListRows.length"
                class="p-4 text-sm text-error"
              >
                목록을 불러오지 못했습니다.
              </div>

              <nav
                v-else
                class="flex flex-col"
              >
                <NuxtLink
                  to="/translate/editor"
                  class="flex min-w-0 items-center gap-2 border-b border-default px-4 py-2.5 text-sm transition-colors"
                  :class="isAllMode ? 'bg-elevated text-default' : 'text-muted hover:bg-elevated hover:text-default'"
                  title="전체 번역"
                  @click="isMobileSidebarOpen = false"
                >
                  <UIcon
                    name="i-tabler-language"
                    class="size-4 shrink-0"
                  />
                  <span class="min-w-0 flex-1 truncate">전체 번역</span>
                  <span class="shrink-0 font-mono text-xs text-[#81C995]">
                    {{ formatEditorPercent(overview.overall.success, overview.overall.total) }}
                  </span>
                </NuxtLink>

                <div
                  v-if="!sidebarListRows.length"
                  class="p-4 text-sm text-muted"
                >
                  {{ sidebarListHasRows ? '검색 결과가 없습니다.' : sidebarListMode === 'category'
                    ? '등록된 파일이 없습니다.' : '등록된 버전이 없습니다.' }}
                </div>

                <NuxtLink
                  v-for="row in sidebarListRows"
                  :key="row.key"
                  :to="row.path"
                  class="flex min-w-0 items-center gap-2 border-b border-default px-4 py-2.5 text-sm transition-colors"
                  :class="isActiveSidebarRow(row) ? 'bg-elevated text-default' : 'text-muted hover:bg-elevated hover:text-default'"
                  :title="row.label"
                  @click="isMobileSidebarOpen = false"
                >
                  <UIcon
                    :name="row.mode === 'category' ? 'i-tabler-file-filled' : 'i-tabler-tag-filled'"
                    class="size-4 shrink-0"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
                  <span class="shrink-0 font-mono text-xs text-[#81C995]">
                    {{ formatEditorPercent(row.counts.success, row.total) }}
                  </span>
                </NuxtLink>
              </nav>
            </div>
          </template>

          <template v-else-if="activeSidebarMenu === 'history'">
            <EditorChangeHistory
              :item-id="selectedItemId"
              :item-key="selectedItemKey"
              :reload-key="historyReloadKey"
              :item-status-label="selectedItemStatusMeta?.label ?? ''"
              :item-status-color="selectedItemStatusMeta?.textColor ?? 'text-muted'"
              :diff-mode="diffMode"
              @changed="handleHistoryChanged"
            />
          </template>

          <template v-else-if="activeSidebarMenu === 'dictionary'">
            <div class="flex min-h-0 flex-1 flex-col">
              <div
                v-if="!dictionarySelection"
                class="flex min-h-0 flex-1 flex-col"
              >
                <div class="shrink-0 p-3 pb-0">
                  <UTabs
                    v-model="dictionaryPanelView"
                    :content="false"
                    :items="dictionaryPanelTabs"
                    color="neutral"
                    size="xs"
                    :ui="{ trigger: 'h-6 px-3 leading-4', list: 'bg-elevated/50' }"
                    class="w-fit"
                  />
                </div>

                <template v-if="dictionaryPanelView === 'search'">
                  <div class="flex shrink-0 gap-2 border-b border-default p-3">
                    <UInput
                      v-model="dictionarySearchInput"
                      color="neutral"
                      variant="soft"
                      class="w-full"
                      placeholder="전체 검색"
                      :ui="{ base: 'h-8 leading-5', trailing: 'pe-1' }"
                      @keydown.enter.prevent="runDictionarySearch"
                    >
                      <template #trailing>
                        <UButton
                          v-if="dictionarySearchInput.length"
                          color="neutral"
                          variant="link"
                          size="sm"
                          icon="i-tabler-x"
                          aria-label="검색어 지우기"
                          @click="dictionarySearchInput = ''"
                        />
                        <UButton
                          icon="i-tabler-search"
                          color="neutral"
                          variant="link"
                          size="sm"
                          aria-label="파일 검색"
                          :disabled="dictionarySearchInput.trim() === dictionarySearch"
                          @click="runDictionarySearch"
                        />
                      </template>
                    </UInput>
                  </div>

                  <div class="min-h-0 flex-1 overflow-y-auto">
                    <div
                      v-if="dictionarySearchStatus === 'pending'"
                      class="flex items-center justify-center p-6 text-muted"
                    >
                      <AppLoadingSpinner />
                    </div>
                    <UAlert
                      v-else-if="dictionarySearchStatus === 'error'"
                      color="error"
                      variant="soft"
                      :title="dictionarySearchError"
                      class="m-3"
                    />
                    <div
                      v-else-if="!dictionarySearch"
                      class="flex flex-col items-center justify-center p-6 text-center text-sm text-muted"
                    >
                      <UIcon
                        name="i-tabler-search"
                        class="size-6 text-dimmed"
                      />
                      <p class="mt-2">
                        검색어를 입력해 주세요.
                      </p>
                    </div>
                    <div
                      v-else-if="!dictionarySearchItems.length"
                      class="flex flex-col items-center justify-center p-6 text-center text-sm text-muted"
                    >
                      <UIcon
                        name="i-tabler-file-search"
                        class="size-6 text-dimmed"
                      />
                      <p class="mt-2">
                        검색 결과가 없습니다.
                      </p>
                    </div>
                    <div
                      v-else
                      class="flex flex-col"
                    >
                      <div class="border-b border-default px-4 py-2 text-xs text-dimmed">
                        {{ formatEditorCount(dictionarySearchData.total) }}개 결과
                      </div>
                      <article
                        v-for="row in dictionarySearchRows"
                        :key="row.item.id"
                        class="border-b border-default hover:bg-elevated/70 transition-colors"
                      >
                        <div class="flex min-w-0 items-start">
                          <button
                            type="button"
                            class="flex min-w-0 flex-1 flex-col gap-2 px-4 py-3 text-left transition-colors"
                            :aria-expanded="expandedDictionarySearchItemId === row.item.id"
                            @click="toggleDictionarySearchItem(row.item.id)"
                          >
                            <div class="flex min-w-0 items-center gap-2">
                              <UIcon
                                name="i-tabler-file-filled"
                                class="size-4 shrink-0 text-dimmed"
                              />
                              <span class="min-w-0 flex-1 truncate text-xs font-medium">
                                <EditorHighlightedText
                                  :text="`${row.item.category}_${row.item.unitKey}`"
                                  :query="dictionarySearch"
                                />
                              </span>
                              <UIcon
                                :name="expandedDictionarySearchItemId === row.item.id ? 'i-tabler-chevron-up' : 'i-tabler-chevron-down'"
                                class="size-4 shrink-0 text-dimmed"
                              />
                            </div>
                            <div class="flex flex-col gap-1 pl-6 text-xs text-muted">
                              <div
                                v-for="field in row.fields"
                                :key="`${row.item.id}-${field.label}`"
                                class="flex min-w-0 gap-2"
                              >
                                <span class="w-16 shrink-0 text-[10px] text-dimmed">{{ field.label }}</span>
                                <span class="min-w-0 flex-1 wrap-break-word">
                                  <EditorHighlightedText
                                    :text="field.text"
                                    :query="dictionarySearch"
                                  />
                                </span>
                              </div>
                            </div>
                          </button>
                        </div>
                        <div
                          v-if="expandedDictionarySearchItemId === row.item.id"
                          class="flex flex-col gap-2 border-t border-default bg-elevated/40 px-4 py-3 relative"
                        >
                          <div
                            v-for="field in row.expandedFields"
                            :key="`${row.item.id}-expanded-${field.label}`"
                            class="flex min-w-0 gap-3 text-xs"
                          >
                            <span class="w-14 shrink-0 text-[10px] text-dimmed text-right">{{ field.label }}</span>
                            <span
                              v-if="field.text"
                              class="min-w-0 flex-1 wrap-break-word whitespace-pre-wrap"
                            >
                              <EditorHighlightedText
                                :text="field.text"
                                :query="dictionarySearch"
                              />
                            </span>
                            <span
                              v-else
                              class="text-dimmed"
                            >—</span>
                          </div>

                          <UButton
                            icon="i-tabler-arrow-up-right"
                            color="info"
                            variant="ghost"
                            size="xs"
                            class="absolute top-2 right-2 p-1"
                            aria-label="항목으로 이동"
                            @click.stop="void openDictionarySearchItem(row.item)"
                          />
                        </div>
                      </article>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <template v-if="selectedDictionary">
                    <div class="flex shrink-0 items-start gap-2 border-b border-default p-3">
                      <UButton
                        icon="i-tabler-arrow-left"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        aria-label="용어집 목록으로 돌아가기"
                        @click="selectedDictionaryId = null"
                      />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">
                          {{ selectedDictionary.name }}
                        </p>
                        <div class="flex min-w-0 items-center gap-1 text-xs text-dimmed">
                          <span class="shrink-0">
                            {{ selectedDictionary.visibility === 'public' ? '공개 용어집' : '비공개 용어집' }} ·
                          </span>
                          <AppUserIdentity
                            :handle="getDictionaryOwnerHandle(selectedDictionary)"
                            :role="selectedDictionary.ownerRole"
                            text-class="text-xs text-dimmed"
                            icon-class="size-3"
                            stop-propagation
                          />
                        </div>
                      </div>
                      <UButton
                        v-if="selectedDictionary.canEdit"
                        icon="i-tabler-plus"
                        color="neutral"
                        variant="soft"
                        size="sm"
                        aria-label="용어 추가"
                        @click="openCreateDictionaryEntry"
                      />
                    </div>

                    <div class="flex shrink-0 gap-2 border-b border-default p-3">
                      <UInput
                        v-model="dictionaryEntriesSearchInput"
                        icon="i-tabler-search"
                        color="neutral"
                        variant="soft"
                        class="w-full"
                        placeholder="용어 검색"
                        :ui="{ base: 'h-8 leading-5', trailing: 'pe-1', leadingIcon: 'size-4' }"
                        @keydown.enter.prevent="runDictionaryEntrySearch"
                      >
                        <template #trailing>
                          <UButton
                            v-if="dictionaryEntriesSearchInput.length"
                            color="neutral"
                            variant="link"
                            size="sm"
                            icon="i-tabler-x"
                            aria-label="용어 검색어 지우기"
                            @click="dictionaryEntriesSearchInput = ''; runDictionaryEntrySearch()"
                          />
                          <UButton
                            icon="i-tabler-search"
                            color="neutral"
                            variant="link"
                            size="sm"
                            aria-label="용어 검색"
                            :disabled="dictionaryEntriesSearchInput.trim() === dictionaryEntriesSearch"
                            @click="runDictionaryEntrySearch"
                          />
                        </template>
                      </UInput>
                    </div>

                    <div class="min-h-0 flex-1 overflow-y-auto">
                      <div
                        v-if="dictionaryEntriesStatus === 'pending'"
                        class="flex items-center justify-center p-6 text-muted"
                      >
                        <AppLoadingSpinner />
                      </div>
                      <UAlert
                        v-else-if="dictionaryEntriesStatus === 'error'"
                        color="error"
                        variant="soft"
                        :title="dictionaryEntriesError"
                        class="m-3"
                      />
                      <div
                        v-else-if="!dictionaryEntryItems.length"
                        class="flex flex-col items-center justify-center p-6 text-center text-sm text-muted"
                      >
                        <UIcon
                          name="i-tabler-book-2"
                          class="size-6 text-dimmed"
                        />
                        <p class="mt-2">
                          아직 등록된 용어가 없습니다.
                        </p>
                        <UButton
                          v-if="selectedDictionary.canEdit"
                          color="neutral"
                          variant="soft"
                          size="sm"
                          class="mt-3"
                          @click="openCreateDictionaryEntry"
                        >
                          용어 추가
                        </UButton>
                      </div>
                      <div
                        v-else
                        class="flex flex-col"
                      >
                        <div class="border-b border-default px-4 py-2 text-xs text-dimmed">
                          {{ formatEditorCount(dictionaryEntries.total) }}개 용어
                        </div>
                        <article
                          v-for="entry in dictionaryEntryItems"
                          :key="entry.id"
                          class="flex flex-col gap-1 border-b border-default px-4 py-3 text-sm"
                        >
                          <div class="flex items-start gap-2">
                            <span class="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word font-medium">{{
                              entry.sourceText }}</span>
                            <UIcon
                              name="i-tabler-arrow-narrow-right"
                              class="mt-0.5 size-4 shrink-0 text-dimmed"
                            />
                            <span class="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word">{{ entry.translation
                            }}</span>
                          </div>
                          <p
                            v-if="entry.note"
                            class="whitespace-pre-wrap wrap-break-word text-xs text-muted"
                          >
                            {{
                              entry.note }}
                          </p>
                          <div class="flex items-center gap-1 text-[10px] text-dimmed">
                            <AppUserIdentity
                              :handle="getDictionaryCreatorHandle(entry)"
                              :role="entry.creatorRole"
                              text-class="text-[10px] text-dimmed"
                              icon-class="size-3"
                              stop-propagation
                            />
                          </div>
                        </article>
                      </div>
                    </div>
                  </template>

                  <template v-else>
                    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-default p-3">
                      <p class="text-sm font-medium h-8 flex items-center">
                        용어집
                      </p>
                      <UButton
                        icon="i-tabler-plus"
                        color="neutral"
                        variant="soft"
                        size="sm"
                        @click="openCreateDictionary"
                      >
                        새 용어집
                      </UButton>
                    </div>

                    <div class="min-h-0 flex-1 overflow-y-auto">
                      <div
                        v-if="dictionariesStatus === 'pending'"
                        class="flex items-center justify-center p-6 text-muted"
                      >
                        <AppLoadingSpinner />
                      </div>
                      <div
                        v-else-if="dictionariesStatus === 'error'"
                        class="flex p-3"
                      >
                        <UAlert
                          color="error"
                          variant="soft"
                          :title="dictionariesError"
                        />
                      </div>
                      <div
                        v-else-if="!dictionaries.length"
                        class="flex flex-col items-center justify-center p-6 text-center text-sm text-muted"
                      >
                        <UIcon
                          name="i-tabler-books"
                          class="size-6 text-dimmed"
                        />
                        <p class="mt-2">
                          등록된 용어집이 없습니다.
                        </p>
                      </div>
                      <nav
                        v-else
                        class="flex flex-col"
                      >
                        <div
                          v-for="dictionary in dictionaries"
                          :key="dictionary.id"
                          role="button"
                          tabindex="0"
                          class="flex min-w-0 items-start gap-3 border-b border-default px-4 py-3 text-left transition-colors hover:bg-elevated/70"
                          @click="selectDictionary(dictionary.id)"
                          @keydown.enter.prevent="selectDictionary(dictionary.id)"
                          @keydown.space.prevent="selectDictionary(dictionary.id)"
                        >
                          <UIcon
                            :name="dictionary.visibility === 'public' ? 'i-tabler-book-2' : 'i-tabler-lock'"
                            class="mt-0.5 size-4 shrink-0 text-dimmed"
                          />
                          <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-medium">{{ dictionary.name }}</span>
                            <span
                              v-if="dictionary.description"
                              class="mt-0.5 block truncate text-xs text-muted"
                            >
                              {{ dictionary.description }}
                            </span>
                            <span class="mt-1 flex items-center gap-1 text-[10px] text-dimmed">
                              <AppUserIdentity
                                :handle="getDictionaryOwnerHandle(dictionary)"
                                :role="dictionary.ownerRole"
                                text-class="text-[10px] text-dimmed"
                                icon-class="size-3"
                                stop-propagation
                              />
                              <span>· {{ formatEditorCount(dictionary.entryCount) }}개 용어</span>
                            </span>
                          </span>
                        </div>
                      </nav>
                    </div>
                  </template>
                </template>

                <UModal
                  v-model:open="dictionaryModalOpen"
                  title="새 용어집"
                  :ui="{ footer: 'justify-end' }"
                >
                  <template #body>
                    <UForm
                      id="editor-dictionary-form"
                      :state="dictionaryForm"
                      class="flex flex-col gap-4"
                      @submit="createDictionary"
                    >
                      <UFormField
                        name="name"
                        label="이름"
                        required
                      >
                        <UInput
                          v-model="dictionaryForm.name"
                          color="neutral"
                          maxlength="100"
                          placeholder="용어집 이름"
                          class="w-full"
                          :ui="{ base: 'h-8 leading-5' }"
                        />
                      </UFormField>
                      <UFormField
                        name="description"
                        label="설명"
                      >
                        <UTextarea
                          v-model="dictionaryForm.description"
                          color="neutral"
                          :rows="3"
                          maxlength="500"
                          placeholder="용어집에 대한 설명"
                          class="w-full"
                        />
                      </UFormField>
                      <UFormField
                        name="visibility"
                        label="공개 범위"
                      >
                        <USelect
                          v-model="dictionaryForm.visibility"
                          color="neutral"
                          :items="[{ label: '공개', value: 'public' }, { label: '비공개', value: 'private' }]"
                          class="w-full"
                          :ui="{ base: 'h-8 leading-5' }"
                        />
                      </UFormField>
                      <p
                        v-if="dictionaryModalError"
                        class="text-sm text-error"
                      >
                        {{ dictionaryModalError }}
                      </p>
                    </UForm>
                  </template>
                  <template #footer>
                    <UButton
                      color="neutral"
                      variant="ghost"
                      @click="dictionaryModalOpen = false"
                    >
                      취소
                    </UButton>
                    <UButton
                      type="submit"
                      form="editor-dictionary-form"
                      color="info"
                      variant="soft"
                      :loading="dictionaryModalSaving"
                    >
                      만들기
                    </UButton>
                  </template>
                </UModal>

                <UModal
                  v-model:open="dictionaryEntryModalOpen"
                  title="용어 추가"
                  :ui="{ footer: 'justify-end' }"
                >
                  <template #body>
                    <UForm
                      id="editor-dictionary-entry-form"
                      :state="dictionaryEntryForm"
                      class="flex flex-col gap-4"
                      @submit="createDictionaryEntry"
                    >
                      <UFormField
                        name="sourceText"
                        label="원문"
                        required
                      >
                        <UTextarea
                          v-model="dictionaryEntryForm.sourceText"
                          color="neutral"
                          :rows="3"
                          maxlength="500"
                          placeholder="원문 용어"
                          class="w-full"
                        />
                      </UFormField>
                      <UFormField
                        name="translation"
                        label="번역"
                        required
                      >
                        <UTextarea
                          v-model="dictionaryEntryForm.translation"
                          color="neutral"
                          :rows="3"
                          maxlength="500"
                          placeholder="번역 용어"
                          class="w-full"
                        />
                      </UFormField>
                      <UFormField
                        name="note"
                        label="메모"
                      >
                        <UTextarea
                          v-model="dictionaryEntryForm.note"
                          color="neutral"
                          :rows="3"
                          maxlength="1000"
                          placeholder="선택 사항"
                          class="w-full"
                        />
                      </UFormField>
                      <p
                        v-if="dictionaryEntryModalError"
                        class="text-sm text-error"
                      >
                        {{ dictionaryEntryModalError }}
                      </p>
                    </UForm>
                  </template>
                  <template #footer>
                    <UButton
                      color="neutral"
                      variant="ghost"
                      @click="dictionaryEntryModalOpen = false"
                    >
                      취소
                    </UButton>
                    <UButton
                      type="submit"
                      form="editor-dictionary-entry-form"
                      color="info"
                      variant="soft"
                      :loading="dictionaryEntryModalSaving"
                    >
                      추가
                    </UButton>
                  </template>
                </UModal>
              </div>

              <div
                v-else-if="dictionaryStatus === 'pending'"
                class="flex flex-1 flex-col"
              >
                <div class="flex shrink-0 items-center gap-2 border-b border-default p-3">
                  <UButton
                    icon="i-tabler-arrow-left"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="사전 메뉴로 돌아가기"
                    @click="dictionarySelection = null"
                  />
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">
                      {{ dictionarySelection.originalText }}
                    </p>
                    <p class="truncate text-xs text-dimmed">
                      {{ dictionaryKey }}
                    </p>
                  </div>
                </div>
                <div class="flex min-h-0 flex-1 items-center justify-center">
                  <AppLoadingSpinner />
                </div>
              </div>

              <div
                v-else-if="dictionaryStatus === 'error'"
                class="flex min-h-0 flex-1 flex-col"
              >
                <div class="flex shrink-0 items-center gap-2 border-b border-default p-3">
                  <UButton
                    icon="i-tabler-arrow-left"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="사전 메뉴로 돌아가기"
                    @click="dictionarySelection = null"
                  />
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">
                      {{ dictionarySelection.originalText }}
                    </p>
                    <p class="truncate text-xs text-dimmed">
                      {{ dictionaryKey }}
                    </p>
                  </div>
                </div>
                <UAlert
                  color="error"
                  variant="soft"
                  title="사전 항목을 불러오지 못했습니다."
                  :description="dictionaryError"
                  class="m-4"
                />
              </div>

              <div
                v-else-if="dictionaryStatus === 'success' && !dictionaryItem"
                class="flex min-h-0 flex-1 flex-col"
              >
                <div class="flex shrink-0 items-center gap-2 border-b border-default p-3">
                  <UButton
                    icon="i-tabler-arrow-left"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="사전 메뉴로 돌아가기"
                    @click="dictionarySelection = null"
                  />
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">
                      {{ dictionarySelection.originalText }}
                    </p>
                    <p class="truncate text-xs text-dimmed">
                      {{ dictionaryKey }}
                    </p>
                  </div>
                </div>
                <div class="flex flex-1 items-center justify-center p-5 text-center text-sm text-muted">
                  <div>
                    <UIcon
                      name="i-tabler-file-off"
                      class="mx-auto size-6 text-dimmed"
                    />
                    <p class="mt-2">
                      대상 사전 항목을 찾을 수 없습니다.
                    </p>
                  </div>
                </div>
              </div>

              <div
                v-else-if="dictionaryItem"
                class="min-h-0 flex flex-1 flex-col"
              >
                <div class="flex shrink-0 items-center gap-2 border-b border-default p-3">
                  <UButton
                    icon="i-tabler-arrow-left"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="사전 메뉴로 돌아가기"
                    @click="dictionarySelection = null"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">
                      {{ dictionarySelection.originalText }}
                    </p>
                    <p class="truncate text-xs text-dimmed">
                      {{ dictionaryKey }}
                    </p>
                  </div>
                  <UButton
                    color="neutral"
                    variant="soft"
                    size="xs"
                    @click="editDictionaryItem"
                  >
                    수정
                  </UButton>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto p-4">
                  <div class="mt-1 flex flex-col gap-3 text-sm">
                    <div
                      v-for="source in visibleSourceLanguageItems"
                      :key="source.key"
                      class="flex flex-col gap-0.5"
                    >
                      <span class="text-[10px] text-dimmed">{{ source.label }}</span>
                      <div class="whitespace-pre-wrap wrap-break-word">
                        <EditorSourceText
                          :text="dictionaryItem[source.key] || null"
                          @select="selectDictionaryReference"
                        >
                          <template #empty>
                            —
                          </template>
                        </EditorSourceText>
                      </div>
                    </div>

                    <div class="flex flex-col gap-0.5 border-t border-default pt-3">
                      <span class="text-[10px] text-dimmed">한국어 번역</span>
                      <p class="whitespace-pre-wrap wrap-break-word">
                        {{ dictionaryItem.ko || '—' }}
                      </p>
                    </div>

                    <div
                      v-if="dictionaryItem.pendingStatus === 'pending'"
                      class="flex flex-col gap-1 border-t border-default pt-3 text-info"
                    >
                      <span class="text-xs font-medium">승인 대기 번역</span>
                      <p class="whitespace-pre-wrap wrap-break-word">
                        {{ dictionaryItem.pendingKo || '—' }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="activeSidebarMenu === 'settings'">
            <div class="flex flex-col gap-4 p-4">
              <div class="flex flex-col gap-2">
                <p class="text-xs font-medium text-muted">
                  원문 표시 언어
                </p>

                <div class="flex flex-col text-sm">
                  <button
                    v-for="language in displayLanguageOptions"
                    :key="language.key"
                    type="button"
                    class="flex items-center gap-2 py-1 pl-1 transition-colors hover:bg-muted"
                    :class="displayLanguages.includes(language.key) ? 'text-default' : 'text-dimmed hover:text-toned'"
                    :aria-pressed="displayLanguages.includes(language.key)"
                    @click="toggleDisplayLanguage(language.key)"
                  >
                    <UIcon
                      v-if="displayLanguages.includes(language.key)"
                      name="i-tabler-check"
                      class="size-4"
                    />
                    <span
                      v-else
                      class="size-4"
                    />
                    <span>{{ language.label }}</span>
                  </button>
                </div>
              </div>

              <div class="flex flex-col gap-2 border-t border-default pt-4">
                <p class="text-xs font-medium text-muted">
                  변경 기록 표시 방식
                </p>

                <div class="flex flex-col text-sm">
                  <button
                    v-for="mode in diffModeOptions"
                    :key="mode.key"
                    type="button"
                    class="flex items-start gap-2 py-1 pl-1 text-left transition-colors hover:bg-muted"
                    :class="diffMode === mode.key ? 'text-default' : 'text-dimmed hover:text-toned'"
                    :aria-pressed="diffMode === mode.key"
                    @click="diffMode = mode.key"
                  >
                    <UIcon
                      v-if="diffMode === mode.key"
                      name="i-tabler-check"
                      class="mt-0.5 size-4 shrink-0"
                    />
                    <span
                      v-else
                      class="mt-0.5 size-4 shrink-0"
                    />
                    <span class="min-w-0">
                      <span class="block">{{ mode.label }}</span>
                      <span class="mt-0.5 block text-xs text-dimmed">{{ mode.description }}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <div
            v-else
            class="flex flex-1 items-center justify-center p-5 text-center"
          >
            <span class="text-sm text-muted">{{ activeSidebarMenuItem.label }} 기능은 준비 중입니다.</span>
          </div>
        </section>

        <nav
          class="absolute inset-x-0 top-0 z-20 flex h-14 shrink-0 gap-2 bg-muted p-2.5 lg:inset-y-0 lg:left-auto lg:right-0 lg:h-auto lg:w-16 lg:flex-col lg:p-3"
        >
          <div class="flex min-w-0 flex-1 gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            <UTooltip
              v-for="menu in sidebarMenuItems"
              :key="menu.key"
              :text="menu.label"
              :delay-duration="0"
              :content="{ side: 'left' }"
            >
              <UButton
                :icon="menu.icon"
                color="neutral"
                variant="ghost"
                size="lg"
                :ui="{ leadingIcon: 'size-5 lg:size-6' }"
                :class="activeSidebarMenu === menu.key ? 'bg-elevated text-default' : 'text-dimmed hover:text-default'"
                :aria-label="menu.label"
                :aria-current="activeSidebarMenu === menu.key ? 'page' : undefined"
                @click="selectSidebarMenu(menu.key)"
              />
            </UTooltip>
          </div>

          <UButton
            icon="i-tabler-x"
            color="neutral"
            variant="ghost"
            size="lg"
            class="text-dimmed lg:hidden"
            aria-label="사이드바 닫기"
            @click="isMobileSidebarOpen = false"
          />

          <div class="hidden lg:block">
            <UTooltip
              :text="isSidebarOpen ? '사이드바 닫기' : '사이드바 열기'"
              :delay-duration="0"
              :content="{ side: 'left' }"
            >
              <UButton
                :icon="isSidebarOpen ? 'i-tabler-layout-sidebar-right-filled' : 'i-tabler-layout-sidebar-right'"
                color="neutral"
                variant="ghost"
                size="xl"
                :class="isSidebarOpen ? 'text-default' : 'text-dimmed hover:text-default'"
                :aria-label="isSidebarOpen ? '사이드바 닫기' : '사이드바 열기'"
                :aria-pressed="isSidebarOpen"
                @click="isSidebarOpen = !isSidebarOpen"
              />
            </UTooltip>
          </div>
        </nav>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.editor-sidebar {
  position: fixed;
  inset: 0;
  z-index: 60;
  width: 100%;
  transform: translateX(100%);
  transition: transform 300ms ease-in-out;
}

.editor-sidebar--mobile-open {
  transform: translateX(0);
}

.editor-sidebar-content {
  width: 100%;
}

@media (min-width: 64rem) {
  .editor-sidebar {
    position: relative;
    inset: auto;
    z-index: auto;
    width: 4rem;
    transform: none;
    transition: width 300ms ease-in-out;
  }

  .editor-sidebar--desktop-open {
    width: max(25%, 28rem);
  }

  .editor-sidebar-content {
    width: calc(max(25vw, 28rem) - 4rem);
  }
}
</style>
