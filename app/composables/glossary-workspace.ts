import type { EditorDictionary, EditorDictionaryEntry, EditorDictionaryEntriesResponse, GlossaryProposal, GlossaryProposalsResponse, GlossaryDecision } from '#shared/types/editor-dictionary'
import { isReviewerRole } from '#shared/types/user'
import { useEditorDictionaryList } from '~/composables/editor-dictionaries'
import { getRequestErrorMessage } from '~/utils/request-error'

export function useGlossaryWorkspace() {
  const route = useRoute()
  const router = useRouter()
  const { loggedIn, user } = useUserSession()
  const { showLoginRequiredToast } = useAppToast()
  const list = useEditorDictionaryList()
  const dictionaries = computed(() => list.dictionaries.value.filter(dictionary => dictionary.isTeam))
  const dictionaryId = ref(typeof route.query.dictionary === 'string' ? route.query.dictionary : '')
  const tab = ref(['term', 'voice', 'proposals'].includes(String(route.query.tab)) ? String(route.query.tab) : 'term')
  const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
  const initialPage = Number(route.query.page ?? 1)
  const page = ref(Number.isSafeInteger(initialPage) && initialPage > 0 ? initialPage : 1)
  const statusFilter = ref(['pending', 'held', 'approved', 'rejected', 'withdrawn'].includes(String(route.query.status)) ? String(route.query.status) : 'pending')
  const archived = ref(route.query.archived === 'true')
  const entries = ref<EditorDictionaryEntriesResponse | null>(null)
  const proposals = ref<GlossaryProposalsResponse | null>(null)
  const loading = ref(false)
  const error = ref('')
  const selection = ref<EditorDictionaryEntry | null>(null)
  const selectedProposal = ref<GlossaryProposal | null>(null)
  const currentProposalEntry = ref<EditorDictionaryEntry | null>(null)
  const comparisonError = ref(false)
  let comparisonRequest = 0
  const detail = ref<'overview' | 'usage' | 'history'>('overview')
  const history = ref<GlossaryProposal[]>([])
  const formOpen = ref(false)
  const editingEntry = ref<EditorDictionaryEntry | null>(null)
  const isReviewer = computed(() => isReviewerRole(user.value?.role))
  function listQuery() {
    return { dictionary: dictionaryId.value || undefined, tab: tab.value, q: search.value || undefined, archived: archived.value ? 'true' : undefined, status: tab.value === 'proposals' ? statusFilter.value : undefined, page: page.value > 1 ? page.value : undefined }
  }
  let request = 0
  let historyRequest = 0
  let navigationRequest = 0
  let initializationRequest = 0
  let applyingState = false
  const pendingQueries = new Set<string>()
  function queryKey(query: Record<string, unknown>) {
    return JSON.stringify(Object.entries(query).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]).sort(([left], [right]) => left!.localeCompare(right!)))
  }
  async function replaceQuery(query: Record<string, string | number | undefined>) {
    const key = queryKey(query)
    if (key === queryKey(route.query)) return
    pendingQueries.add(key)
    try {
      await router.replace({ query })
    } finally {
      pendingQueries.delete(key)
    }
  }
  function clearSelection() {
    historyRequest++
    comparisonRequest++
    selection.value = null
    selectedProposal.value = null
    currentProposalEntry.value = null
    comparisonError.value = false
    detail.value = 'overview'
    history.value = []
  }
  async function load() {
    const id = ++request
    const previousProposalId = selectedProposal.value?.id
    const dictionary = dictionaryId.value
    const kind = tab.value
    const query = { page: page.value, kind, search: search.value, archived: archived.value ? 'true' : undefined }
    const linkedEntryId = route.query.dictionary === dictionary && typeof route.query.entry === 'string' ? route.query.entry : ''
    const linkedDetail = linkedEntryId && (route.query.detail === 'history' || route.query.detail === 'usage') ? route.query.detail : 'overview'
    entries.value = null
    proposals.value = null
    clearSelection()
    error.value = ''
    if (!dictionaryId.value || (tab.value === 'proposals' && !loggedIn.value)) {
      loading.value = false
      return
    }
    loading.value = true
    try {
      if (tab.value === 'proposals') {
        const response = await $fetch<GlossaryProposalsResponse>(`/api/editor/dictionaries/${dictionary}/proposals`, { query: { page: query.page, status: statusFilter.value || undefined } })
        if (id !== request) return
        proposals.value = response
        selectedProposal.value = response.proposals.find(proposal => proposal.id === previousProposalId) ?? response.proposals[0] ?? null
      } else {
        const response = await $fetch<EditorDictionaryEntriesResponse>(`/api/editor/dictionaries/${dictionary}/entries`, { query })
        if (id !== request) return
        entries.value = response
        let entry = response.entries.find(entry => entry.id === linkedEntryId) ?? response.entries[0] ?? null
        if (linkedEntryId && !query.search && !response.entries.some(entry => entry.id === linkedEntryId)) {
          const linked = await $fetch<EditorDictionaryEntry>(`/api/editor/dictionaries/${dictionary}/entries/${encodeURIComponent(linkedEntryId)}`)
          if (id !== request) return
          if (linked.metadata.kind === kind && linked.metadata.archived === (query.archived === 'true')) entry = linked
        }
        selection.value = entry
        detail.value = entry?.id === linkedEntryId ? linkedDetail : 'overview'
        if (linkedEntryId && entry?.id !== linkedEntryId) {
          await replaceQuery(listQuery())
          if (id !== request) return
        }
        if (entry && detail.value === 'history' && loggedIn.value) await fetchHistory(entry)
      }
    } catch (cause) {
      if (id === request) error.value = getRequestErrorMessage(cause, '기준을 불러오지 못했습니다.')
    } finally {
      if (id === request) loading.value = false
    }
  }
  async function init() {
    const id = ++initializationRequest
    await list.loadDictionaries()
    if (id !== initializationRequest) return
    if (list.dictionariesStatus.value === 'error') {
      error.value = list.dictionariesError.value
      return
    }
    if (!dictionaries.value.some(dictionary => dictionary.id === dictionaryId.value)) {
      const nextDictionaryId = dictionaries.value[0]?.id ?? ''
      if (dictionaryId.value !== nextDictionaryId) {
        dictionaryId.value = nextDictionaryId
        return
      }
    }
    await load()
  }
  async function resetList(resetPage: boolean) {
    const id = ++navigationRequest
    request++
    clearSelection()
    if (resetPage) {
      applyingState = true
      page.value = 1
      applyingState = false
    }
    await replaceQuery(listQuery())
    if (id === navigationRequest) await load()
  }
  async function runSearch() {
    await resetList(true)
  }
  async function selectEntry(entry: EditorDictionaryEntry) {
    historyRequest++
    selection.value = entry
    detail.value = 'overview'
    history.value = []
    await replaceQuery({ ...listQuery(), entry: entry.id })
  }
  function propose(entry: EditorDictionaryEntry | null = null) {
    if (!loggedIn.value) {
      showLoginRequiredToast('glossary-login')
      return
    }
    editingEntry.value = entry
    formOpen.value = true
  }
  async function fetchHistory(entry: EditorDictionaryEntry) {
    const id = ++historyRequest
    history.value = []
    try {
      const response = await $fetch<GlossaryProposalsResponse>(`/api/editor/dictionaries/${entry.dictionaryId}/proposals`, { query: { entryId: entry.id } })
      if (id === historyRequest && detail.value === 'history' && selection.value?.id === entry.id && selection.value.dictionaryId === entry.dictionaryId) history.value = response.proposals
    } catch (cause) {
      if (id === historyRequest && detail.value === 'history') error.value = getRequestErrorMessage(cause, '이력을 불러오지 못했습니다.')
    }
  }
  async function showDetail(next: 'overview' | 'usage' | 'history') {
    if (next === 'history' && !loggedIn.value) {
      showLoginRequiredToast('glossary-history-login')
      return
    }
    const entry = selection.value
    if (!entry) return
    const id = ++historyRequest
    detail.value = next
    history.value = []
    await replaceQuery({ ...listQuery(), entry: entry.id, detail: next === 'overview' ? undefined : next })
    if (id === historyRequest && next === 'history') await fetchHistory(entry)
  }
  async function showHistory() {
    await showDetail('history')
  }
  const deciding = ref(false)
  async function decide(action: GlossaryDecision, reason: string, proposal = selectedProposal.value) {
    if (!proposal || deciding.value) return false
    deciding.value = true
    error.value = ''
    try {
      await $fetch(`/api/editor/dictionaries/${proposal.dictionaryId}/proposals/${proposal.id}`, { method: 'PATCH', body: { action, reason } })
      await load()
      return true
    } catch (cause) {
      error.value = getRequestErrorMessage(cause, '처리하지 못했습니다. 최신 확정판과 제안 상태를 확인해 주세요.')
      return false
    } finally {
      deciding.value = false
    }
  }
  async function createDictionary(name: string) {
    const dictionary = await $fetch<EditorDictionary>('/api/editor/dictionaries', { method: 'POST', body: { name, description: '팀에서 합의한 용어와 캐릭터 문체', visibility: 'public', isTeam: true } })
    await list.loadDictionaries()
    dictionaryId.value = dictionary.id
  }
  watch([dictionaryId, tab, statusFilter, archived], () => {
    if (!applyingState) void resetList(true)
  }, { flush: 'sync' })
  watch(page, () => {
    if (!applyingState) void resetList(false)
  }, { flush: 'sync' })
  watch(() => route.query, () => {
    if (pendingQueries.has(queryKey(route.query))) return
    navigationRequest++
    request++
    applyingState = true
    dictionaryId.value = typeof route.query.dictionary === 'string' ? route.query.dictionary : ''
    tab.value = ['term', 'voice', 'proposals'].includes(String(route.query.tab)) ? String(route.query.tab) : 'term'
    search.value = typeof route.query.q === 'string' ? route.query.q : ''
    const nextPage = Number(route.query.page ?? 1)
    page.value = Number.isSafeInteger(nextPage) && nextPage > 0 ? nextPage : 1
    statusFilter.value = ['pending', 'held', 'approved', 'rejected', 'withdrawn'].includes(String(route.query.status)) ? String(route.query.status) : 'pending'
    archived.value = route.query.archived === 'true'
    applyingState = false
    void load()
  }, { flush: 'sync' })
  watch(loggedIn, () => {
    void init()
  })
  watch(selectedProposal, async (proposal) => {
    const requestId = ++comparisonRequest
    currentProposalEntry.value = null
    comparisonError.value = false
    if (!proposal?.entryId) return
    try {
      const entry = await $fetch<EditorDictionaryEntry>(`/api/editor/dictionaries/${proposal.dictionaryId}/entries/${proposal.entryId}`)
      if (requestId === comparisonRequest) currentProposalEntry.value = entry
    } catch { if (requestId === comparisonRequest) comparisonError.value = true }
  })
  onUnmounted(() => {
    request++
    comparisonRequest++
    historyRequest++
    navigationRequest++
    initializationRequest++
  })
  return { loggedIn, user, dictionaries, dictionaryId, tab, search, page, statusFilter, archived, entries, proposals, loading, error, selection, selectedProposal, currentProposalEntry, comparisonError, detail, history, formOpen, editingEntry, isReviewer, deciding, init, load, runSearch, selectEntry, propose, showDetail, showHistory, decide, createDictionary }
}
