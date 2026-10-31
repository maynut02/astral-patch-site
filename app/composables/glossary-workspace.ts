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
  async function load() {
    const id = ++request
    const previousProposalId = selectedProposal.value?.id
    entries.value = null
    proposals.value = null
    selection.value = null
    selectedProposal.value = null
    history.value = []
    error.value = ''
    if (!dictionaryId.value || (tab.value === 'proposals' && !loggedIn.value)) {
      loading.value = false
      return
    }
    loading.value = true
    try {
      if (tab.value === 'proposals') {
        const response = await $fetch<GlossaryProposalsResponse>(`/api/editor/dictionaries/${dictionaryId.value}/proposals`, { query: { page: page.value, status: statusFilter.value || undefined } })
        if (id !== request) return
        proposals.value = response
        selectedProposal.value = response.proposals.find(proposal => proposal.id === previousProposalId) ?? response.proposals[0] ?? null
      } else {
        const response = await $fetch<EditorDictionaryEntriesResponse>(`/api/editor/dictionaries/${dictionaryId.value}/entries`, { query: { page: page.value, kind: tab.value, search: search.value, archived: archived.value ? 'true' : undefined } })
        if (id !== request) return
        entries.value = response
        selection.value = response.entries.find(entry => entry.id === route.query.entry) ?? response.entries[0] ?? null
        if (typeof route.query.entry === 'string' && route.query.dictionary === dictionaryId.value && !search.value && !response.entries.some(entry => entry.id === route.query.entry)) {
          const linked = await $fetch<EditorDictionaryEntry>(`/api/editor/dictionaries/${dictionaryId.value}/entries/${encodeURIComponent(route.query.entry)}`)
          if (id !== request) return
          if (linked.metadata.kind === tab.value && linked.metadata.archived === archived.value) selection.value = linked
        }
        if (route.query.detail === 'history' && loggedIn.value) await showHistory()
      }
    } catch (cause) {
      if (id === request) error.value = getRequestErrorMessage(cause, '기준을 불러오지 못했습니다.')
    } finally {
      if (id === request) loading.value = false
    }
  }
  async function init() {
    await list.loadDictionaries()
    if (list.dictionariesStatus.value === 'error') {
      error.value = list.dictionariesError.value
      return
    }
    if (!dictionaries.value.some(dictionary => dictionary.id === dictionaryId.value)) dictionaryId.value = dictionaries.value[0]?.id ?? ''
    await load()
  }
  async function runSearch() {
    page.value = 1
    await router.replace({ query: listQuery() })
    await load()
  }
  async function selectEntry(entry: EditorDictionaryEntry) {
    selection.value = entry
    detail.value = 'overview'
    await router.replace({ query: { ...listQuery(), entry: entry.id } })
  }
  function propose(entry: EditorDictionaryEntry | null = null) {
    if (!loggedIn.value) {
      showLoginRequiredToast('glossary-login')
      return
    }
    editingEntry.value = entry
    formOpen.value = true
  }
  async function showHistory() {
    if (!loggedIn.value) {
      showLoginRequiredToast('glossary-history-login')
      return
    }
    const entry = selection.value
    if (!entry) return
    detail.value = 'history'
    history.value = []
    try {
      const response = await $fetch<GlossaryProposalsResponse>(`/api/editor/dictionaries/${entry.dictionaryId}/proposals`, { query: { entryId: entry.id } })
      if (selection.value?.id === entry.id) history.value = response.proposals
    } catch (cause) {
      if (selection.value?.id === entry.id) error.value = getRequestErrorMessage(cause, '이력을 불러오지 못했습니다.')
    }
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
    await load()
  }
  watch([dictionaryId, tab, statusFilter, archived], async () => {
    page.value = 1
    detail.value = 'overview'
    await router.replace({ query: listQuery() })
    await load()
  })
  watch(page, async () => {
    await router.replace({ query: listQuery() })
    await load()
  })
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
  })
  return { loggedIn, user, dictionaries, dictionaryId, tab, search, page, statusFilter, archived, entries, proposals, loading, error, selection, selectedProposal, currentProposalEntry, comparisonError, detail, history, formOpen, editingEntry, isReviewer, deciding, init, load, runSearch, selectEntry, propose, showHistory, decide, createDictionary }
}
