import type { EditorItemStatusFilter, EditorSearchMatch, EditorSearchType } from '#shared/types/editor'
import { EDITOR_DIFF_MODE_OPTIONS, EDITOR_SEARCH_MATCH_LABELS, EDITOR_SEARCH_MATCH_OPTIONS, EDITOR_SEARCH_TYPE_LABELS, EDITOR_SEARCH_TYPE_OPTIONS, EDITOR_SOURCE_LANGUAGE_OPTIONS } from '~/utils/editor-options'
import { getEditorQueryString, isEditorSearchMatch, isEditorSearchType, normalizeEditorRevision, normalizeEditorVersion } from '~/utils/editor-helpers'
import type { useEditorLayout } from '~/composables/editor-layout'
import { getEditorKeyQuery } from '~/utils/editor-links'

type EditorListMode = 'category' | 'version'
type EditorViewFilter = 'all' | EditorItemStatusFilter | 'changed'

interface EditorViewFilterOption {
  key: EditorViewFilter
  label: string
  disabled?: boolean
}

export function useEditorQuery(layout: ReturnType<typeof useEditorLayout>) {
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

  const selectFirstItemOnNextLoad = ref(false)

  const scrollAfterLoad = ref(false)

  const { isMobileSidebarOpen } = layout
  const route = useRoute()
  const router = useRouter()

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

  const viewFilterLabels = Object.fromEntries(viewFilterOptions.map(option => [option.key, option.label])) as Record<EditorViewFilter, string>

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
  const editorPageTitle = computed(() => {
    if (isFileMode.value) {
      return `${category.value} - 번역 에디터`
    }

    if (isTagMode.value) {
      return `v${version.value} · r${revision.value} - 번역 에디터`
    }

    return '번역 에디터'
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

  watch([search, searchType, searchMatch, viewFilter, category, version, revision], () => {
    selectFirstItemOnNextLoad.value = true
    scrollAfterLoad.value = true
    page.value = 1
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

  async function jumpToEditorKey(key: string, file?: string): Promise<void> {
    isMobileSidebarOpen.value = false
    selectFirstItemOnNextLoad.value = true
    scrollAfterLoad.value = true
    await router.push({ query: getEditorKeyQuery(key, file) })
  }

  return {
    page,
    optionsPopoverOpen,
    searchInput,
    search,
    searchFilterOpen,
    searchType,
    searchMatch,
    viewFilterOpen,
    viewFilter,
    sidebarListMode,
    sidebarListSearch,
    selectFirstItemOnNextLoad,
    scrollAfterLoad,
    sourceLanguageItems,
    displayLanguageOptions,
    searchTypeOptions,
    searchMatchOptions,
    diffModeOptions,
    searchTypeLabels,
    searchMatchLabels,
    viewFilterOptions,
    viewFilterLabels,
    category,
    version,
    revision,
    isFileMode,
    isTagMode,
    isAllMode,
    editorPageTitle,
    headerTitle,
    activeFilterTags,
    isSearchFilterActive,
    isViewFilterActive,
    backPath,
    applySearch,
    selectSearchType,
    selectSearchMatch,
    selectViewFilter,
    removeFilterTag,
    jumpToEditorKey,
    route,
    router
  }
}
