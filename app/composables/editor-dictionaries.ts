import type {
  EditorDictionariesResponse,
  EditorDictionary,
  EditorDictionaryEntriesResponse,
  EditorDictionaryEntry,
  EditorDictionaryVisibility
} from '#shared/types/editor-dictionary'

export type EditorDictionaryRequestStatus = 'idle' | 'pending' | 'success' | 'error'

const EMPTY_DICTIONARY_ENTRIES: EditorDictionaryEntriesResponse = {
  entries: [],
  total: 0,
  page: 1,
  pageSize: 50,
  totalPages: 1
}

// 용어집 목록·항목 조회와 생성 폼 상태를 한 곳에서 관리한다.
export function useEditorDictionaries() {
  const { loggedIn } = useUserSession()
  const { showLoginRequiredToast } = useAppToast()

  const dictionaries = ref<EditorDictionary[]>([])
  const dictionariesStatus = ref<EditorDictionaryRequestStatus>('idle')
  const dictionariesError = ref('')
  const dictionariesRequestId = ref(0)
  const selectedDictionaryId = ref<string | null>(null)

  const dictionaryEntries = ref<EditorDictionaryEntriesResponse>({ ...EMPTY_DICTIONARY_ENTRIES })
  const dictionaryEntriesStatus = ref<EditorDictionaryRequestStatus>('idle')
  const dictionaryEntriesError = ref('')
  const dictionaryEntriesSearchInput = ref('')
  const dictionaryEntriesSearch = ref('')
  const dictionaryEntriesRequestId = ref(0)

  const dictionaryModalOpen = ref(false)
  const dictionaryEntryModalOpen = ref(false)
  const dictionaryModalSaving = ref(false)
  const dictionaryEntryModalSaving = ref(false)
  const dictionaryModalError = ref('')
  const dictionaryEntryModalError = ref('')

  const dictionaryForm = reactive<{
    name: string
    description: string
    visibility: EditorDictionaryVisibility
  }>({
    name: '',
    description: '',
    visibility: 'private'
  })

  const dictionaryEntryForm = reactive({
    sourceText: '',
    translation: '',
    note: ''
  })

  const selectedDictionary = computed(() => dictionaries.value.find(dictionary =>
    dictionary.id === selectedDictionaryId.value
  ) ?? null)
  const dictionaryEntryItems = computed(() => dictionaryEntries.value.entries)

  async function loadDictionaries(): Promise<void> {
    const requestId = ++dictionariesRequestId.value
    dictionariesStatus.value = 'pending'
    dictionariesError.value = ''

    try {
      const response = await $fetch<EditorDictionariesResponse>('/api/editor/dictionaries')

      if (requestId !== dictionariesRequestId.value) {
        return
      }

      dictionaries.value = response.dictionaries
      dictionariesStatus.value = 'success'

      if (selectedDictionaryId.value && !response.dictionaries.some(dictionary => dictionary.id === selectedDictionaryId.value)) {
        selectedDictionaryId.value = null
        dictionaryEntries.value = { ...EMPTY_DICTIONARY_ENTRIES }
      }
    } catch {
      if (requestId !== dictionariesRequestId.value) {
        return
      }

      dictionariesStatus.value = 'error'
      dictionariesError.value = '용어집 목록을 불러오지 못했습니다.'
    }
  }

  async function loadDictionaryEntries(): Promise<void> {
    const dictionaryId = selectedDictionaryId.value
    const requestId = ++dictionaryEntriesRequestId.value

    if (!dictionaryId) {
      dictionaryEntries.value = { ...EMPTY_DICTIONARY_ENTRIES }
      dictionaryEntriesStatus.value = 'idle'
      dictionaryEntriesError.value = ''
      return
    }

    dictionaryEntriesStatus.value = 'pending'
    dictionaryEntriesError.value = ''

    try {
      const response = await $fetch<EditorDictionaryEntriesResponse>(
        `/api/editor/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        {
          query: {
            page: 1,
            search: dictionaryEntriesSearch.value || undefined
          }
        }
      )

      if (requestId !== dictionaryEntriesRequestId.value) {
        return
      }

      dictionaryEntries.value = response
      dictionaryEntriesStatus.value = 'success'
    } catch {
      if (requestId !== dictionaryEntriesRequestId.value) {
        return
      }

      dictionaryEntriesStatus.value = 'error'
      dictionaryEntriesError.value = '용어집 항목을 불러오지 못했습니다.'
    }
  }

  function selectDictionary(dictionaryId: string): void {
    selectedDictionaryId.value = dictionaryId
    dictionaryEntriesSearchInput.value = ''
    dictionaryEntriesSearch.value = ''
    void loadDictionaryEntries()
  }

  function runDictionaryEntrySearch(): void {
    dictionaryEntriesSearch.value = dictionaryEntriesSearchInput.value.trim()
    void loadDictionaryEntries()
  }

  function openCreateDictionary(): void {
    if (!loggedIn.value) {
      showLoginRequiredToast('editor-dictionary-login-required')
      return
    }

    dictionaryForm.name = ''
    dictionaryForm.description = ''
    dictionaryForm.visibility = 'private'
    dictionaryModalError.value = ''
    dictionaryModalOpen.value = true
  }

  async function createDictionary(): Promise<void> {
    const name = dictionaryForm.name.trim()

    if (!name) {
      dictionaryModalError.value = '용어집 이름을 입력하세요.'
      return
    }

    dictionaryModalSaving.value = true
    dictionaryModalError.value = ''

    try {
      const dictionary = await $fetch<EditorDictionary>('/api/editor/dictionaries', {
        method: 'POST',
        body: {
          name,
          description: dictionaryForm.description,
          visibility: dictionaryForm.visibility
        }
      })

      dictionaries.value = [dictionary, ...dictionaries.value]
      dictionariesStatus.value = 'success'
      selectedDictionaryId.value = dictionary.id
      dictionaryEntries.value = { ...EMPTY_DICTIONARY_ENTRIES }
      dictionaryEntriesStatus.value = 'idle'
      dictionaryModalOpen.value = false
    } catch {
      dictionaryModalError.value = '용어집을 만들지 못했습니다.'
    } finally {
      dictionaryModalSaving.value = false
    }
  }

  function openCreateDictionaryEntry(): void {
    dictionaryEntryForm.sourceText = ''
    dictionaryEntryForm.translation = ''
    dictionaryEntryForm.note = ''
    dictionaryEntryModalError.value = ''
    dictionaryEntryModalOpen.value = true
  }

  async function createDictionaryEntry(): Promise<void> {
    const dictionaryId = selectedDictionaryId.value

    if (!dictionaryId) {
      return
    }

    if (!dictionaryEntryForm.sourceText.trim() || !dictionaryEntryForm.translation.trim()) {
      dictionaryEntryModalError.value = '원문과 번역을 모두 입력하세요.'
      return
    }

    dictionaryEntryModalSaving.value = true
    dictionaryEntryModalError.value = ''

    try {
      await $fetch<EditorDictionaryEntry>(
        `/api/editor/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        {
          method: 'POST',
          body: {
            sourceText: dictionaryEntryForm.sourceText,
            translation: dictionaryEntryForm.translation,
            note: dictionaryEntryForm.note
          }
        }
      )

      dictionaryEntryModalOpen.value = false
      await loadDictionaryEntries()
      await loadDictionaries()
    } catch {
      dictionaryEntryModalError.value = '용어집 항목을 추가하지 못했습니다.'
    } finally {
      dictionaryEntryModalSaving.value = false
    }
  }

  return {
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
  }
}
