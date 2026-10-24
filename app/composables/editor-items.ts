import type { EditorItem } from '#shared/types/editor'
import type { EditorProgressCounts, EditorProgressStatus, EditorProgressSummary } from '#shared/types/editor-overview'
import { formatEditorVersion, normalizeEditorRevision, normalizeEditorVersion } from '~/utils/editor-helpers'
import type { EditorPageData } from '~/utils/editor-page-state'
import type { useEditorQuery } from '~/composables/editor-query'
import type { useEditorLayout } from '~/composables/editor-layout'
import type { useEditorDraftStorage } from '~/composables/editor-drafts'
import { EDITOR_STATUS_META, createEmptyEditorOverview, getEditorItemStatus } from '~/utils/editor-progress'
import { getEditorCategoryPath, getEditorVersionPath, getEditorItemKey } from '~/utils/editor-links'

type EditorListMode = 'category' | 'version'

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

export function useEditorItems(data: EditorPageData, query: ReturnType<typeof useEditorQuery>, layout: ReturnType<typeof useEditorLayout>, draftStorage: ReturnType<typeof useEditorDraftStorage>) {
  const { itemsData, itemsStatus, overviewData, overviewStatus, overviewError } = data
  const { page, category, version, revision, isFileMode, isTagMode, sidebarListMode, sidebarListSearch, selectFirstItemOnNextLoad, scrollAfterLoad } = query
  const { scrollListToTop } = layout
  const { drafts, hasItemDraft, applyDraftsToItems, loadDrafts, getDraftKey } = draftStorage

  function getItemDraftKey(item: Pick<EditorItem, 'id'>): string {
    return getDraftKey(item.id)
  }

  const selectedItemId = ref<string | null>(null)

  const historyReloadKey = ref(0)

  const items = computed(() => itemsData.value?.items ?? [])
  const selectedItem = computed(() => items.value.find(item => item.id === selectedItemId.value) ?? null)
  const selectedItemKey = computed(() => selectedItem.value ? getEditorItemKey(selectedItem.value) : '')
  const selectedItemHasSource = computed(() => selectedItem.value
    ? [selectedItem.value.cnS, selectedItem.value.en, selectedItem.value.jp, selectedItem.value.cnT]
        .some(text => text.trim())
    : false)

  const total = computed(() => itemsData.value?.total ?? 0)
  const totalPages = computed(() => Math.max(1, itemsData.value?.totalPages ?? 1))
  const isLoading = computed(() => itemsStatus.value === 'idle' || itemsStatus.value === 'pending')
  const overview = computed(() => overviewData.value ?? createEmptyEditorOverview())
  const isSidebarListLoading = computed(() => overviewStatus.value === 'idle' || overviewStatus.value === 'pending')
  const sidebarListHasError = computed(() => Boolean(overviewError.value))
  const persistedItemStates = ref<Record<string, PersistedItemState>>({})

  function setPersistedItemState(id: string, state: PersistedItemState): void {
    persistedItemStates.value[id] = {
      ko: state.ko,
      pendingStatus: state.pendingStatus,
      approvedForCurrentSource: state.approvedForCurrentSource
    }
  }

  function capturePersistedStates(serverItems: EditorItem[]): void {
    for (const item of serverItems) setPersistedItemState(item.id, item)
  }
  const currentPageDrafts = computed(() => items.value.flatMap((item) => {
    const draft = drafts.value[getItemDraftKey(item)]

    return draft ? [{ item, draft }] : []
  }))
  const currentPageDraftCount = computed(() => currentPageDrafts.value.length)
  const selectedItemHasDraft = computed(() => selectedItem.value ? hasItemDraft(selectedItem.value) : false)
  const selectedItemStatus = computed(() => selectedItem.value ? getItemStatus(selectedItem.value) : null)
  const selectedItemStatusMeta = computed(() => selectedItemStatus.value
    ? EDITOR_STATUS_META[selectedItemStatus.value]
    : null)

  const sidebarCategoryRows = computed<SidebarListRow[]>(() => {
    const query = sidebarListSearch.value.trim().toLowerCase()

    return overview.value.categories
      .filter(item => !query || item.category.toLowerCase().includes(query))
      .map(item => ({
        key: `category:${item.category}`,
        label: item.category,
        path: getEditorCategoryPath(item.category),
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
        path: getEditorVersionPath(item.version, item.revision),
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

    capturePersistedStates(data.items)
    // 서버 원본을 먼저 기록한 다음 로컬 임시 번역을 복원한다.
    applyDraftsToItems(data.items)
  }, { immediate: true })

  const currentProgress = computed<EditorProgressSummary>(() => {
    if (isFileMode.value) {
      const categoryProgress = overview.value.categories.find(item => item.category === category.value)

      return categoryProgress
        ? { total: categoryProgress.total, ...categoryProgress.counts }
        : createEmptyEditorOverview().overall
    }

    if (isTagMode.value) {
      const versionProgress = overview.value.versions.find(item =>
        normalizeEditorVersion(item.version) === version.value
        && normalizeEditorRevision(item.revision) === revision.value
      )

      return versionProgress
        ? { total: versionProgress.total, ...versionProgress.counts }
        : createEmptyEditorOverview().overall
    }

    return overview.value.overall
  })

  function isActiveSidebarRow(row: SidebarListRow): boolean {
    if (row.mode === 'category') {
      return isFileMode.value && row.value === category.value
    }

    return isTagMode.value && row.value === `${version.value}:${revision.value}`
  }

  function getItemStatus(item: EditorItem): EditorProgressStatus {
    return getEditorItemStatus(persistedItemStates.value[item.id] ?? item)
  }

  function canRetainItem(item: EditorItem): boolean {
    return getItemStatus(item) === 'warning' && !hasItemDraft(item)
  }

  function selectItem(item: EditorItem): void {
    selectedItemId.value = item.id
  }

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

  onMounted(() => {
    loadDrafts()
    applyDraftsToItems(items.value)
  })

  return {
    selectedItemId,
    historyReloadKey,
    items,
    selectedItem,
    selectedItemKey,
    selectedItemHasSource,
    total,
    totalPages,
    isLoading,
    overview,
    isSidebarListLoading,
    sidebarListHasError,
    persistedItemStates,
    setPersistedItemState,
    capturePersistedStates,
    currentPageDrafts,
    currentPageDraftCount,
    selectedItemHasDraft,
    selectedItemStatus,
    selectedItemStatusMeta,
    sidebarCategoryRows,
    sidebarVersionRows,
    sidebarListRows,
    sidebarListHasRows,
    currentProgress,
    isActiveSidebarRow,
    getItemStatus,
    getItemDraftKey,
    canRetainItem,
    selectItem
  }
}
