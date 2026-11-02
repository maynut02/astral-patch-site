import type { LocationQueryRaw } from 'vue-router'
import type { EditorDictionary, EditorDictionaryEntry, EditorDictionaryEntriesResponse, GlossaryProposal, GlossaryProposalsResponse, GlossaryDecision } from '#shared/types/editor-dictionary'
import { isReviewerRole } from '#shared/types/user'
import { useEditorDictionaryList } from '~/composables/editor-dictionaries'
import { getRequestErrorMessage } from '~/utils/request-error'

export interface GlossaryWorkspaceTarget {
  dictionary: string
  tab?: 'term' | 'voice'
  entry?: string
  detail?: 'usage' | 'history'
}

type GlossaryQuery = LocationQueryRaw

function parseGlossaryQuery(query: GlossaryQuery) {
  const page = Number(query.page ?? 1)
  return {
    dictionary: typeof query.dictionary === 'string' ? query.dictionary : '',
    tab: ['term', 'voice', 'proposals'].includes(String(query.tab)) ? String(query.tab) : 'term',
    search: typeof query.q === 'string' ? query.q : '',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    status: ['pending', 'held', 'approved', 'rejected', 'withdrawn'].includes(String(query.status)) ? String(query.status) : 'pending',
    archived: query.archived === 'true'
  }
}

/**
 * `syncRoute: false` keeps the workspace location in memory so an embedded
 * workspace never rewrites the host page URL (the editor owns its own query).
 */
export function useGlossaryWorkspace(options: { syncRoute?: boolean } = {}) {
  const syncRoute = options.syncRoute ?? true
  const route = useRoute()
  const router = useRouter()
  const localQuery = shallowRef<GlossaryQuery>({})
  const currentQuery = (): GlossaryQuery => syncRoute ? route.query : localQuery.value
  const locationQuery = computed(currentQuery)
  const { loggedIn, user } = useUserSession()
  const { showLoginRequiredToast } = useAppToast()
  const list = useEditorDictionaryList()
  const dictionaries = computed(() => list.dictionaries.value.filter(dictionary => dictionary.isTeam))
  const initial = parseGlossaryQuery(currentQuery())
  const dictionaryId = ref(initial.dictionary)
  const tab = ref(initial.tab)
  const search = ref(initial.search)
  const page = ref(initial.page)
  const statusFilter = ref(initial.status)
  const archived = ref(initial.archived)
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
    if (key === queryKey(currentQuery())) return
    if (!syncRoute) {
      localQuery.value = query
      return
    }
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
    const linked = currentQuery()
    const linkedEntryId = linked.dictionary === dictionary && typeof linked.entry === 'string' ? linked.entry : ''
    const linkedDetail = linkedEntryId && (linked.detail === 'history' || linked.detail === 'usage') ? linked.detail : 'overview'
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
      loading.value = false
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
  async function closeEntry() {
    historyRequest++
    detail.value = 'overview'
    history.value = []
    await replaceQuery(listQuery())
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
  function applyQuery(query: GlossaryQuery) {
    navigationRequest++
    request++
    applyingState = true
    const next = parseGlossaryQuery(query)
    dictionaryId.value = next.dictionary
    tab.value = next.tab
    search.value = next.search
    page.value = next.page
    statusFilter.value = next.status
    archived.value = next.archived
    applyingState = false
  }
  async function open(target: GlossaryWorkspaceTarget) {
    const query = { dictionary: target.dictionary, tab: target.tab, entry: target.entry, detail: target.detail }
    if (syncRoute) {
      await router.replace({ query })
      return
    }
    localQuery.value = query
    applyQuery(query)
    // applyQuery invalidated any in-flight load; drop its rows so they never show under the new target.
    entries.value = null
    proposals.value = null
    clearSelection()
    await init()
  }
  watch([dictionaryId, tab, statusFilter, archived], () => {
    if (!applyingState) void resetList(true)
  }, { flush: 'sync' })
  watch(page, () => {
    if (!applyingState) void resetList(false)
  }, { flush: 'sync' })
  if (syncRoute) {
    watch(() => route.query, () => {
      if (pendingQueries.has(queryKey(route.query))) return
      applyQuery(route.query)
      void load()
    }, { flush: 'sync' })
  }
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
  return { loggedIn, user, dictionaries, dictionaryId, tab, search, page, statusFilter, archived, entries, proposals, loading, error, selection, selectedProposal, currentProposalEntry, comparisonError, detail, history, formOpen, editingEntry, isReviewer, deciding, locationQuery, init, load, open, runSearch, selectEntry, closeEntry, propose, showDetail, showHistory, decide, createDictionary }
}

export type GlossaryWorkspace = ReturnType<typeof useGlossaryWorkspace>
