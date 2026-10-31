import type { EditorDictionariesResponse, EditorDictionary } from '#shared/types/editor-dictionary'
import type { GlossaryHarvestCandidate, GlossaryHarvestPreview, GlossaryHarvestResponse, GlossaryHarvestSubmitResult } from '#shared/types/glossary-harvest'
import { isReviewerRole } from '#shared/types/user'
import { getRequestErrorMessage } from '~/utils/request-error'

export interface HarvestDraft extends GlossaryHarvestCandidate {
  selected: boolean
  result?: GlossaryHarvestSubmitResult['results'][number]
}

export function useGlossaryHarvest() {
  const route = useRoute()
  const { user, loggedIn } = useUserSession()
  const isReviewer = computed(() => isReviewerRole(user.value?.role))
  const dictionaryId = typeof route.query.dictionary === 'string' ? route.query.dictionary : ''
  const dictionary = ref<EditorDictionary | null>(null)
  const corpus = ref<GlossaryHarvestResponse | null>(null)
  const category = ref('')
  const page = ref(1)
  const selectedSources = ref<string[]>([])
  const drafts = ref<HarvestDraft[]>([])
  const activeId = ref('')
  const active = computed(() => drafts.value.find(row => row.requestId === activeId.value) ?? null)
  const loading = ref(false)
  const extracting = ref(false)
  const submitting = ref(false)
  const importing = ref(false)
  const exporting = ref(false)
  const busy = computed(() => loading.value || extracting.value || submitting.value || importing.value || exporting.value)
  const error = ref('')
  const message = ref('')
  const storageError = ref('')
  const importOpen = ref(false)
  const importJson = ref('')
  const importSources = ref<GlossaryHarvestResponse['sources']>([])
  const selected = computed(() => drafts.value.filter(row => row.selected && row.result?.status !== 'submitted' && row.result?.status !== 'duplicate'))
  const sources = computed(() => corpus.value?.sources.filter(source => selectedSources.value.includes(source.itemId)) ?? [])
  let alive = true
  let ready = false
  let request = 0
  const storageKey = () => `astral-glossary-harvest-v1:${user.value?.id}:${dictionaryId}`

  function persist() {
    if (!ready || !alive) return
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ category: category.value, page: page.value, activeId: activeId.value, drafts: drafts.value }))
      storageError.value = ''
    } catch { storageError.value = '후보를 브라우저에 보관하지 못했습니다. 후보 JSON을 내려받아 주세요.' }
  }
  async function load() {
    const id = ++request
    loading.value = true
    error.value = ''
    corpus.value = null
    selectedSources.value = []
    try {
      const response = await $fetch<GlossaryHarvestResponse>(`/api/editor/dictionaries/${dictionaryId}/harvest`, { query: { category: category.value || undefined, page: page.value } })
      if (!alive || id !== request) return
      corpus.value = response
      selectedSources.value = response.sources.map(source => source.itemId)
    } catch (cause) {
      if (alive && id === request) error.value = getRequestErrorMessage(cause, '확정 번역을 불러오지 못했습니다.')
    } finally { if (alive && id === request) loading.value = false }
  }
  async function init() {
    if (!isReviewer.value || !dictionaryId) return
    loading.value = true
    try {
      const response = await $fetch<EditorDictionariesResponse>('/api/editor/dictionaries')
      if (!alive) return
      dictionary.value = response.dictionaries.find(row => row.id === dictionaryId && row.isTeam) ?? null
      if (!dictionary.value) throw new Error('공통 용어집을 선택해 주세요.')
      try {
        const saved = localStorage.getItem(storageKey())
        if (saved) {
          const value = JSON.parse(saved) as { category?: unknown, page?: unknown, activeId?: unknown, drafts?: unknown }
          if (!Array.isArray(value.drafts) || value.drafts.length > 200 || value.drafts.some(row => !row || typeof row.requestId !== 'string' || !row.source || typeof row.source.fingerprint !== 'string' || !['translation', 'japanese', 'chineseSimplified', 'chineseTraditional', 'note'].every(field => typeof row[field] === 'string'))) throw new Error('Invalid draft')
          drafts.value = value.drafts.map(row => ({ ...row, semanticReview: row.semanticReview ?? 'unrecorded', semanticNote: row.semanticNote ?? '' }))
          category.value = typeof value.category === 'string' ? value.category : ''
          page.value = typeof value.page === 'number' && Number.isSafeInteger(value.page) && value.page > 0 ? value.page : 1
          activeId.value = typeof value.activeId === 'string' ? value.activeId : ''
        }
      } catch { storageError.value = '보관된 후보를 복원하지 못했습니다. 내려받은 JSON이 있다면 다시 가져와 주세요.' }
      ready = true
      await load()
    } catch (cause) {
      if (alive) error.value = getRequestErrorMessage(cause, '용어집을 불러오지 못했습니다.')
    } finally { if (alive) loading.value = false }
  }
  async function changePage(next: number) {
    if (busy.value) return
    page.value = next
    await load()
    persist()
  }
  async function changeCategory(value: string) {
    if (busy.value) return
    category.value = value
    page.value = 1
    await load()
    persist()
  }
  function merge(preview: GlossaryHarvestPreview) {
    let duplicates = 0
    const additions = preview.candidates.filter((candidate) => {
      const exists = drafts.value.some(row => row.translation === candidate.translation && row.source.category === candidate.source.category
        && (['japanese', 'chineseSimplified', 'chineseTraditional'] as const).some(field => candidate[field] && row[field] === candidate[field]))
      if (exists) duplicates++
      return !exists
    })
    if (drafts.value.length + additions.length > 200) throw new Error('후보는 200개까지 보관합니다. 처리한 후보를 비운 뒤 가져와 주세요.')
    drafts.value.push(...additions.map(candidate => ({ ...candidate, selected: false })))
    activeId.value = additions[0]?.requestId ?? activeId.value
    message.value = `${additions.length}개 후보 · 중복·근거 불일치 ${preview.excluded + duplicates}개 제외`
    persist()
  }
  async function extract() {
    if (busy.value || !sources.value.length) return
    extracting.value = true
    error.value = ''
    message.value = ''
    try {
      const result = await $fetch<GlossaryHarvestPreview>(`/api/editor/dictionaries/${dictionaryId}/harvest/extract`, { method: 'POST', body: { sources: sources.value.map(source => ({ itemId: source.itemId, fingerprint: source.fingerprint })) }, timeout: 70_000, retry: 0 })
      if (alive) merge(result)
    } catch (cause) {
      if (alive) error.value = getRequestErrorMessage(cause, '용어를 추출하지 못했습니다.')
    } finally { if (alive) extracting.value = false }
  }
  function openImport() {
    importSources.value = [...sources.value]
    importJson.value = ''
    importOpen.value = true
  }
  async function previewImport() {
    if (busy.value) return
    importing.value = true
    error.value = ''
    try {
      const value: unknown = JSON.parse(importJson.value.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('candidates 배열이 있는 JSON을 넣어 주세요.')
      const data = value as { sources?: unknown, candidates?: unknown, format?: unknown }
      const candidateRefs = Array.isArray(data.candidates) && data.candidates.every(row => row && typeof row.itemId === 'string' && typeof row.fingerprint === 'string')
        ? data.candidates.map(row => ({ itemId: row.itemId, fingerprint: row.fingerprint }))
        : null
      const refs = Array.isArray(data.sources) ? data.sources : candidateRefs ?? importSources.value.map(source => ({ itemId: source.itemId, fingerprint: source.fingerprint }))
      const preview = await $fetch<GlossaryHarvestPreview>(`/api/editor/dictionaries/${dictionaryId}/harvest/preview`, {
        method: 'POST', body: { sources: refs, json: JSON.stringify({ candidates: data.candidates, format: data.format }) }
      })
      if (alive) {
        merge(preview)
        importOpen.value = false
      }
    } catch (cause) {
      if (alive) error.value = cause instanceof SyntaxError ? 'JSON 형식이 올바르지 않습니다.' : getRequestErrorMessage(cause, '후보 JSON을 확인해 주세요.')
    } finally { if (alive) importing.value = false }
  }
  async function submit() {
    if (busy.value || !selected.value.length || selected.value.length > 20) return
    const targets = selected.value.map(({ selected: _selected, result: _result, source, ...row }) => ({ ...row, source: { itemId: source.itemId, fingerprint: source.fingerprint } }))
    submitting.value = true
    error.value = ''
    message.value = ''
    try {
      const response = await $fetch<GlossaryHarvestSubmitResult>(`/api/editor/dictionaries/${dictionaryId}/harvest/submit`, { method: 'POST', body: { candidates: targets }, retry: 0 })
      if (!alive) return
      for (const result of response.results) {
        const row = drafts.value.find(candidate => candidate.requestId === result.requestId)
        if (row) {
          row.result = result
          if (result.status !== 'error') row.selected = false
        }
      }
      message.value = `검토 대기 ${response.results.filter(row => row.status === 'submitted').length}개 · 중복 ${response.results.filter(row => row.status === 'duplicate').length}개 · 실패 ${response.results.filter(row => row.status === 'error').length}개`
      persist()
    } catch (cause) {
      if (alive) error.value = getRequestErrorMessage(cause, '등록하지 못했습니다. 입력을 유지하며 같은 요청으로 재시도할 수 있습니다.')
    } finally { if (alive) submitting.value = false }
  }
  function download(name: string, text: string, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }
  function exportCandidates() {
    const remaining = drafts.value.filter(row => row.result?.status !== 'submitted')
    const refs = [...new Map(remaining.map(row => [row.source.itemId, { itemId: row.source.itemId, fingerprint: row.source.fingerprint }])).values()]
    // 가져오기 한도와 맞추기 위해 근거 20개 단위의 파일을 만든다.
    for (let offset = 0; offset < remaining.length; offset += 20) {
      const candidates = remaining.slice(offset, offset + 20)
      const ids = new Set(candidates.map(row => row.source.itemId))
      download(`glossary-candidates-${offset / 20 + 1}.json`, JSON.stringify({ format: 'astral-glossary-candidates-v1', sources: refs.filter(row => ids.has(row.itemId)), candidates: candidates.map(({ selected: _selected, result: _result, source, ...row }) => ({ ...row, source: { itemId: source.itemId, fingerprint: source.fingerprint } })) }, null, 2))
    }
  }
  async function exportCorpus() {
    if (busy.value) return
    exporting.value = true
    error.value = ''
    try {
      const data = await $fetch(`/api/editor/dictionaries/${dictionaryId}/harvest/export`, { query: { category: category.value || undefined } })
      if (alive) download(`glossary-sources-${category.value || 'all'}.json`, JSON.stringify(data, null, 2))
    } catch (cause) {
      if (alive) error.value = getRequestErrorMessage(cause, '확정 번역을 내보내지 못했습니다.')
    } finally { if (alive) exporting.value = false }
  }
  function remove(id: string) {
    if (busy.value) return
    drafts.value = drafts.value.filter(row => row.requestId !== id)
    if (activeId.value === id) activeId.value = drafts.value[0]?.requestId ?? ''
    persist()
  }
  watch(drafts, persist, { deep: true })
  watch(activeId, persist)
  watch([() => user.value?.id, isReviewer], () => {
    request++
    ready = false
    corpus.value = null
    dictionary.value = null
    drafts.value = []
    if (isReviewer.value) void init()
  })
  onMounted(init)
  onUnmounted(() => {
    alive = false
    request++
  })
  return { loggedIn, isReviewer, dictionaryId, dictionary, corpus, category, page, selectedSources, drafts, activeId, active, loading, extracting, importing, exporting, submitting, busy, error, message, storageError, importOpen, importJson, selected, sources, init, load, changePage, changeCategory, extract, openImport, previewImport, submit, download, exportCandidates, exportCorpus, remove }
}
