import type {
  EditorDictionariesResponse,
  EditorDictionary,
  EditorDictionaryEntriesResponse,
  EditorDictionaryEntry,
  EditorDictionaryVisibility
} from '#shared/types/editor-dictionary'

export type EditorDictionaryRequestStatus = 'idle' | 'pending' | 'success' | 'error'

function createEmptyDictionaryEntries(): EditorDictionaryEntriesResponse {
  return { entries: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }
}

export type EditorDictionaryDeleteTarget
  = | { kind: 'dictionary', dictionaryId: string, label: string }
    | { kind: 'entry', dictionaryId: string, entryId: string, label: string }

export function useEditorDictionaryList() {
  const dictionaries = ref<EditorDictionary[]>([])
  const dictionariesStatus = ref<EditorDictionaryRequestStatus>('idle')
  const dictionariesError = ref('')
  const dictionariesRequestId = ref(0)
  const selectedDictionaryId = ref<string | null>(null)

  const dictionaryEntries = ref<EditorDictionaryEntriesResponse>(createEmptyDictionaryEntries())
  const dictionaryEntriesStatus = ref<EditorDictionaryRequestStatus>('idle')
  const dictionaryEntriesError = ref('')
  const dictionaryEntriesSearchInput = ref('')
  const dictionaryEntriesSearch = ref('')
  const dictionaryEntriesRequestId = ref(0)

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
        dictionaryEntries.value = createEmptyDictionaryEntries()
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
      dictionaryEntries.value = createEmptyDictionaryEntries()
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
    loadDictionaries,
    loadDictionaryEntries,
    selectDictionary,
    runDictionaryEntrySearch
  }
}

export function useEditorDictionaryForms(list: ReturnType<typeof useEditorDictionaryList>) {
  const { dictionaries, dictionariesStatus, selectedDictionaryId, dictionaryEntries, dictionaryEntriesStatus, loadDictionaryEntries, loadDictionaries } = list

  const { loggedIn } = useUserSession()
  const { showLoginRequiredToast } = useAppToast()

  const dictionaryModalOpen = ref(false)
  const dictionaryEntryModalOpen = ref(false)
  const dictionaryModalSaving = ref(false)
  const dictionaryEntryModalSaving = ref(false)
  const dictionaryModalError = ref('')
  const dictionaryEntryModalError = ref('')
  // null while creating; the target id while editing.
  const editingDictionaryId = ref<string | null>(null)
  const editingDictionaryEntry = ref<{ dictionaryId: string, entryId: string } | null>(null)
  const dictionaryDeleteTarget = ref<EditorDictionaryDeleteTarget | null>(null)
  const dictionaryDeleteModalOpen = ref(false)
  const dictionaryDeleteSaving = ref(false)
  const dictionaryDeleteError = ref('')

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

  function openCreateDictionary(): void {
    if (!loggedIn.value) {
      showLoginRequiredToast('editor-dictionary-login-required')
      return
    }

    editingDictionaryId.value = null
    dictionaryForm.name = ''
    dictionaryForm.description = ''
    dictionaryForm.visibility = 'private'
    dictionaryModalError.value = ''
    dictionaryModalOpen.value = true
  }

  function openEditDictionary(dictionary: EditorDictionary): void {
    editingDictionaryId.value = dictionary.id
    dictionaryForm.name = dictionary.name
    dictionaryForm.description = dictionary.description
    dictionaryForm.visibility = dictionary.visibility
    dictionaryModalError.value = ''
    dictionaryModalOpen.value = true
  }

  async function saveDictionary(): Promise<void> {
    const name = dictionaryForm.name.trim()

    if (!name) {
      dictionaryModalError.value = '용어집 이름을 입력하세요.'
      return
    }

    if (dictionaryModalSaving.value) {
      return
    }

    const editingId = editingDictionaryId.value
    dictionaryModalSaving.value = true
    dictionaryModalError.value = ''

    try {
      const body = { name, description: dictionaryForm.description, visibility: dictionaryForm.visibility }
      if (editingId) {
        const dictionary = await $fetch<EditorDictionary>(`/api/editor/dictionaries/${encodeURIComponent(editingId)}`, {
          method: 'PATCH',
          body
        })
        dictionaries.value = dictionaries.value.map(item => item.id === dictionary.id ? dictionary : item)
        dictionaryModalOpen.value = false
        // Supersede any list request that started before the rename.
        void loadDictionaries()
        return
      }

      const dictionary = await $fetch<EditorDictionary>('/api/editor/dictionaries', {
        method: 'POST',
        body
      })

      dictionaries.value = [dictionary, ...dictionaries.value]
      dictionariesStatus.value = 'success'
      selectedDictionaryId.value = dictionary.id
      dictionaryEntries.value = createEmptyDictionaryEntries()
      dictionaryEntriesStatus.value = 'idle'
      dictionaryModalOpen.value = false
    } catch {
      dictionaryModalError.value = editingId ? '용어집을 수정하지 못했습니다.' : '용어집을 만들지 못했습니다.'
    } finally {
      dictionaryModalSaving.value = false
    }
  }

  function openCreateDictionaryEntry(): void {
    editingDictionaryEntry.value = null
    dictionaryEntryForm.sourceText = ''
    dictionaryEntryForm.translation = ''
    dictionaryEntryForm.note = ''
    dictionaryEntryModalError.value = ''
    dictionaryEntryModalOpen.value = true
  }

  function openEditDictionaryEntry(entry: EditorDictionaryEntry): void {
    editingDictionaryEntry.value = { dictionaryId: entry.dictionaryId, entryId: entry.id }
    dictionaryEntryForm.sourceText = entry.sourceText
    dictionaryEntryForm.translation = entry.translation
    dictionaryEntryForm.note = entry.note
    dictionaryEntryModalError.value = ''
    dictionaryEntryModalOpen.value = true
  }

  async function saveDictionaryEntry(): Promise<void> {
    const editing = editingDictionaryEntry.value
    const dictionaryId = editing?.dictionaryId ?? selectedDictionaryId.value

    if (!dictionaryId || dictionaryEntryModalSaving.value) {
      return
    }

    if (!dictionaryEntryForm.sourceText.trim() || !dictionaryEntryForm.translation.trim()) {
      dictionaryEntryModalError.value = '원문과 번역을 모두 입력하세요.'
      return
    }

    dictionaryEntryModalSaving.value = true
    dictionaryEntryModalError.value = ''

    try {
      const dictionaryPath = `/api/editor/dictionaries/${encodeURIComponent(dictionaryId)}/entries`
      const body = {
        sourceText: dictionaryEntryForm.sourceText,
        translation: dictionaryEntryForm.translation,
        note: dictionaryEntryForm.note
      }
      await (editing
        ? $fetch<EditorDictionaryEntry>(`${dictionaryPath}/${encodeURIComponent(editing.entryId)}`, { method: 'PATCH', body })
        : $fetch<EditorDictionaryEntry>(dictionaryPath, { method: 'POST', body }))

      dictionaryEntryModalOpen.value = false
      void loadDictionaryEntries()
      void loadDictionaries()
    } catch (error) {
      if (editing && getRequestErrorStatus(error) === 404) {
        // Deleted elsewhere: show the current list instead of a retry that cannot succeed.
        dictionaryEntryModalError.value = '이미 삭제된 용어입니다.'
        void loadDictionaryEntries()
        void loadDictionaries()
        return
      }
      dictionaryEntryModalError.value = editing ? '용어집 항목을 수정하지 못했습니다.' : '용어집 항목을 추가하지 못했습니다.'
    } finally {
      dictionaryEntryModalSaving.value = false
    }
  }

  function openDeleteDictionaryTarget(target: EditorDictionaryDeleteTarget): void {
    dictionaryDeleteTarget.value = target
    dictionaryDeleteError.value = ''
    dictionaryDeleteModalOpen.value = true
  }

  function openDeleteDictionary(dictionary: EditorDictionary): void {
    openDeleteDictionaryTarget({ kind: 'dictionary', dictionaryId: dictionary.id, label: dictionary.name })
  }

  function openDeleteDictionaryEntry(entry: EditorDictionaryEntry): void {
    openDeleteDictionaryTarget({ kind: 'entry', dictionaryId: entry.dictionaryId, entryId: entry.id, label: entry.sourceText })
  }

  async function confirmDictionaryDelete(): Promise<void> {
    const target = dictionaryDeleteTarget.value

    if (!target || dictionaryDeleteSaving.value) {
      return
    }

    dictionaryDeleteSaving.value = true
    dictionaryDeleteError.value = ''

    try {
      const dictionaryPath = `/api/editor/dictionaries/${encodeURIComponent(target.dictionaryId)}`
      try {
        await $fetch(target.kind === 'entry' ? `${dictionaryPath}/entries/${encodeURIComponent(target.entryId)}` : dictionaryPath, { method: 'DELETE' })
      } catch (error) {
        // 404 means it is already gone, which is the requested end state.
        if (getRequestErrorStatus(error) !== 404) {
          dictionaryDeleteError.value = target.kind === 'entry' ? '용어를 삭제하지 못했습니다.' : '용어집을 삭제하지 못했습니다.'
          return
        }
      }

      dictionaryDeleteModalOpen.value = false
      if (target.kind === 'dictionary') {
        dictionaries.value = dictionaries.value.filter(dictionary => dictionary.id !== target.dictionaryId)
        if (selectedDictionaryId.value === target.dictionaryId) {
          selectedDictionaryId.value = null
          dictionaryEntries.value = createEmptyDictionaryEntries()
          dictionaryEntriesStatus.value = 'idle'
        }
      } else {
        await loadDictionaryEntries()
      }
      // Also supersedes any list request that started before the delete.
      await loadDictionaries()
    } finally {
      dictionaryDeleteSaving.value = false
    }
  }

  return {
    dictionaryModalOpen,
    dictionaryEntryModalOpen,
    dictionaryModalSaving,
    dictionaryEntryModalSaving,
    dictionaryModalError,
    dictionaryEntryModalError,
    dictionaryForm,
    dictionaryEntryForm,
    editingDictionaryId,
    editingDictionaryEntry,
    dictionaryDeleteTarget,
    dictionaryDeleteModalOpen,
    dictionaryDeleteSaving,
    dictionaryDeleteError,
    openCreateDictionary,
    openEditDictionary,
    saveDictionary,
    openCreateDictionaryEntry,
    openEditDictionaryEntry,
    saveDictionaryEntry,
    openDeleteDictionary,
    openDeleteDictionaryEntry,
    confirmDictionaryDelete
  }
}
