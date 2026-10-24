import type { EditorItem, EditorItemsResponse } from '#shared/types/editor'
import type { EditorDictionary, EditorDictionaryEntry } from '#shared/types/editor-dictionary'
import { normalizeEditorHandle } from '~/utils/editor-helpers'
import { useEditorDictionaryList, useEditorDictionaryForms } from '~/composables/editor-dictionaries'
import type { useEditorQuery } from '~/composables/editor-query'
import type { useEditorLayout } from '~/composables/editor-layout'
import { createEmptyEditorItems } from '~/utils/editor-progress'
import { getEditorItemKey } from '~/utils/editor-links'
import { createEditorDictionaryItemsRequest } from '~/utils/editor-dictionary-request'

type EditorDictionaryPanelView = 'search' | 'collections'
type EditorDictionaryRequestStatus = 'idle' | 'pending' | 'success' | 'error'
type AstralLinkType = 'Buff' | 'Card'

interface AstralReference {
  type: AstralLinkType
  id: string
  originalText: string
}

interface EditorDictionarySearchField {
  label: string
  text: string
  lang?: string
}

function getDictionaryOwnerHandle(dictionary: EditorDictionary): string {
  return normalizeEditorHandle(dictionary.ownerHandle)
}

function getDictionaryCreatorHandle(entry: EditorDictionaryEntry): string {
  return normalizeEditorHandle(entry.creatorHandle)
}

export function useEditorDictionaryPanel(query: ReturnType<typeof useEditorQuery>, layout: ReturnType<typeof useEditorLayout>) {
  const { isMobileSidebarOpen, activeSidebarMenu, isSidebarOpen } = layout
  const { jumpToEditorKey, sourceLanguageItems } = query

  const dictionarySelection = ref<AstralReference | null>(null)
  const dictionaryItem = ref<EditorItem | null>(null)
  const dictionaryStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
  const dictionaryError = ref('')
  const dictionaryRequest = createEditorDictionaryItemsRequest()
  const dictionaryPanelView = ref<EditorDictionaryPanelView>('search')
  const dictionarySearchInput = ref('')
  const dictionarySearch = ref('')
  const dictionarySearchData = ref<EditorItemsResponse>(createEmptyEditorItems())
  const expandedDictionarySearchItemId = ref<string | null>(null)
  const dictionarySearchStatus = ref<EditorDictionaryRequestStatus>('idle')
  const dictionarySearchError = ref('')
  const dictionarySearchRequest = createEditorDictionaryItemsRequest()

  const dictionaryList = useEditorDictionaryList()
  const dictionaryForms = useEditorDictionaryForms(dictionaryList)
  const { dictionariesStatus, loadDictionaries } = dictionaryList

  const dictionaryPanelTabs = [
    { label: '검색', value: 'search' },
    { label: '용어집', value: 'collections' }
  ] satisfies { label: string, value: EditorDictionaryPanelView }[]

  const dictionaryNamespace = computed(() => dictionarySelection.value?.type === 'Buff' ? 'STRBuff' : 'STRCard')
  const dictionaryKey = computed(() => dictionarySelection.value
    ? `${dictionaryNamespace.value}_${dictionarySelection.value.id}`
    : '')

  const dictionarySearchItems = computed(() => dictionarySearchData.value.items)

  function getDictionarySearchFields(item: EditorItem): EditorDictionarySearchField[] {
    const query = dictionarySearch.value.trim().toLocaleLowerCase()
    const fields: EditorDictionarySearchField[] = [
      { label: 'Key', text: getEditorItemKey(item) },
      ...sourceLanguageItems.map(language => ({
        label: language.label,
        text: item[language.key],
        lang: language.lang
      })),
      { label: '한국어', text: item.ko, lang: 'ko' }
    ]

    return fields.filter(field => field.text && field.text.toLocaleLowerCase().includes(query))
  }

  function getDictionaryExpandedFields(item: EditorItem): EditorDictionarySearchField[] {
    return [
      ...sourceLanguageItems.map(language => ({
        label: language.label,
        text: item[language.key],
        lang: language.lang
      })),
      { label: '한국어', text: item.ko, lang: 'ko' }
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
    dictionarySearchRequest.invalidate()

    if (!nextSearch) {
      dictionarySearchData.value = createEmptyEditorItems()
      dictionarySearchStatus.value = 'idle'
      dictionarySearchError.value = ''
      return
    }

    dictionarySearchStatus.value = 'pending'
    dictionarySearchError.value = ''

    try {
      const result = await dictionarySearchRequest.fetchItems({
        page: 1,
        search: nextSearch,
        searchType: 'all',
        match: 'contains'
      })
      if (!dictionarySearchRequest.isCurrent(result)) return
      if (!result.response) throw result.error
      const response = result.response

      dictionarySearchData.value = response
      dictionarySearchStatus.value = 'success'
    } catch {
      dictionarySearchData.value = createEmptyEditorItems()
      dictionarySearchStatus.value = 'error'
      dictionarySearchError.value = '파일 검색 결과를 불러오지 못했습니다.'
    }
  }

  async function openDictionarySearchItem(item: EditorItem): Promise<void> {
    dictionarySelection.value = null
    await jumpToEditorKey(getEditorItemKey(item), item.category)
  }

  async function loadDictionaryItem(selection: AstralReference | null): Promise<void> {
    dictionaryRequest.invalidate()

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
      const result = await dictionaryRequest.fetchItems({
        page: 1,
        category: dictionaryNamespace.value,
        search: dictionaryKey.value,
        searchType: 'key',
        match: 'exact'
      })
      if (!dictionaryRequest.isCurrent(result)) return
      if (!result.response) throw result.error
      const response = result.response

      dictionaryItem.value = response.items.find(item =>
        item.category === dictionaryNamespace.value
        && item.unitKey === selection.id
      ) ?? null
      dictionaryStatus.value = 'success'
    } catch {
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

    dictionarySelection.value = null
    await jumpToEditorKey(getEditorItemKey(item), item.category)
  }

  watch(dictionarySelection, (selection) => {
    void loadDictionaryItem(selection)
  })

  watch(dictionaryPanelView, (view) => {
    if (view === 'collections' && dictionariesStatus.value !== 'pending') {
      void loadDictionaries()
    }
  })

  return {
    dictionarySelection,
    dictionaryItem,
    dictionaryStatus,
    dictionaryError,
    dictionaryPanelView,
    dictionarySearchInput,
    dictionarySearch,
    dictionarySearchData,
    expandedDictionarySearchItemId,
    dictionarySearchStatus,
    dictionarySearchError,
    dictionaryPanelTabs,
    dictionaryNamespace,
    dictionaryKey,
    dictionarySearchItems,
    getDictionarySearchFields,
    getDictionaryExpandedFields,
    dictionarySearchRows,
    toggleDictionarySearchItem,
    runDictionarySearch,
    openDictionarySearchItem,
    loadDictionaryItem,
    selectDictionaryReference,
    editDictionaryItem,
    ...dictionaryList,
    ...dictionaryForms,
    getDictionaryOwnerHandle,
    getDictionaryCreatorHandle
  }
}
