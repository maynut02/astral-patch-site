<script setup lang="ts">
import {
  EDITOR_ALL_CATEGORY_VALUE,
  EDITOR_ALL_REVISION_VALUE,
  type EditorFiltersResponse,
  type EditorLanguage,
  type EditorItemsResponse,
  type EditorItem,
  type EditorSaveResponse
} from '#shared/types/editor'

const languageItems: { key: EditorLanguage, label: string }[] = [
  { key: 'cnS', label: '중국어 간체' },
  { key: 'en', label: '영어' },
  { key: 'jp', label: '일본어' },
  { key: 'cnT', label: '중국어 번체' }
]

const defaultFilters: EditorFiltersResponse = {
  categories: [],
  revisions: []
}

const defaultItems: EditorItemsResponse = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 50,
  totalPages: 1
}

const route = useRoute()
const router = useRouter()
const languageStorageKey = 'astral-editor-languages'

function getQueryString(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

function getQueryPage(value: unknown): number {
  const page = Number(getQueryString(value) || '1')

  if (!Number.isInteger(page) || page < 1) {
    return 1
  }

  return Math.min(page, 100000)
}

function getQueryBoolean(value: unknown): boolean {
  return ['true', '1', 'on'].includes(getQueryString(value).toLowerCase())
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '')
}

function normalizeRevision(value: string): string {
  return value.trim().replace(/^r/i, '')
}

function getRevisionLabel(version: string, revision: string): string {
  return `v${normalizeVersion(version)}_r${normalizeRevision(revision)}`
}

function getRevisionParts(label: string): { version: string, revision: string } | null {
  const match = /^v(.+)_r(.+)$/.exec(label)

  if (!match) {
    return null
  }

  return {
    version: normalizeVersion(match[1] ?? ''),
    revision: normalizeRevision(match[2] ?? '')
  }
}

function getAllLanguages(): EditorLanguage[] {
  return languageItems.map(language => language.key)
}

function isEditorLanguage(value: unknown): value is EditorLanguage {
  return value === 'cnS' || value === 'en' || value === 'jp' || value === 'cnT'
}

const initialVersion = normalizeVersion(getQueryString(route.query.version))
const initialRevision = normalizeRevision(getQueryString(route.query.revision))
const hasInitialVersion = Boolean(initialVersion && initialRevision)

const search = ref(getQueryString(route.query.search))
const category = ref(hasInitialVersion ? EDITOR_ALL_CATEGORY_VALUE : getQueryString(route.query.file) || EDITOR_ALL_CATEGORY_VALUE)
const version = ref(initialVersion)
const revision = ref(initialRevision)
const revisionId = ref(EDITOR_ALL_REVISION_VALUE)
const itemId = ref(getQueryString(route.query.itemId))
const editRequested = ref(getQueryBoolean(route.query.edit))
const selectedLanguages = ref<EditorLanguage[]>(getAllLanguages())
const untranslatedOnly = ref(getQueryBoolean(route.query.untranslated))
const page = ref(getQueryPage(route.query.page))
let applyingRouteQuery = false
let searchQueryTimer: ReturnType<typeof setTimeout> | undefined
const languageStorageReady = ref(false)

const { ready: sessionReady, loggedIn } = useUserSession()
const canEdit = computed(() => sessionReady.value && loggedIn.value)
const editingItemId = ref<string | null>(null)
const draftKo = ref('')
const originalKo = ref('')
const editError = ref('')
const saving = ref(false)
const historyOpen = ref(false)
const historyItemId = ref<string | null>(null)
const historyReloadKey = ref(0)
const toast = useToast()

const requestQuery = computed(() => ({
  page: page.value,
  search: search.value || undefined,
  category: category.value && category.value !== EDITOR_ALL_CATEGORY_VALUE ? category.value : undefined,
  version: version.value || undefined,
  revision: revision.value || undefined,
  revisionId: !version.value && !revision.value && revisionId.value && revisionId.value !== EDITOR_ALL_REVISION_VALUE
    ? revisionId.value
    : undefined,
  itemId: itemId.value || undefined,
  untranslated: untranslatedOnly.value ? 'true' : undefined
}))

const { data: filterData, status: filterStatus, error: filterError } = await useFetch<EditorFiltersResponse>('/api/editor/filters', {
  default: () => defaultFilters
})

const { data: editorData, status: editorStatus, error: editorError, refresh: refreshItems } = await useFetch<EditorItemsResponse>('/api/editor/items', {
  query: requestQuery,
  default: () => defaultItems,
  watch: [requestQuery]
})

const categoryItems = computed(() => filterData.value?.categories ?? defaultFilters.categories)
const revisionItems = computed(() => filterData.value?.revisions ?? defaultFilters.revisions)
const items = computed(() => editorData.value?.items ?? [])
const total = computed(() => editorData.value?.total ?? 0)
const totalPages = computed(() => editorData.value?.totalPages ?? 1)
const displayedPage = computed(() => editorData.value?.page ?? page.value)
const isLoading = computed(() => filterStatus.value === 'pending' || editorStatus.value === 'pending')
const hasError = computed(() => Boolean(filterError.value || editorError.value))
const visibleLanguageItems = computed(() => languageItems.filter(language => selectedLanguages.value.includes(language.key)))

function resolveRevisionId() {
  if (!version.value || !revision.value) {
    if (revisionId.value !== EDITOR_ALL_REVISION_VALUE) {
      revisionId.value = EDITOR_ALL_REVISION_VALUE
    }
    return
  }

  const revisionOption = revisionItems.value.find(option => option.label === getRevisionLabel(version.value, revision.value))
  const nextRevisionId = revisionOption?.value ?? EDITOR_ALL_REVISION_VALUE

  if (revisionId.value !== nextRevisionId) {
    revisionId.value = nextRevisionId
  }
}

watch([revisionItems, version, revision], resolveRevisionId, { immediate: true })

watch(category, (value) => {
  if (applyingRouteQuery || value === EDITOR_ALL_CATEGORY_VALUE) {
    return
  }

  version.value = ''
  revision.value = ''
  revisionId.value = EDITOR_ALL_REVISION_VALUE
})

watch(revisionId, (value) => {
  if (applyingRouteQuery || value === EDITOR_ALL_REVISION_VALUE) {
    return
  }

  const revisionOption = revisionItems.value.find(option => option.value === value)
  const parts = revisionOption ? getRevisionParts(revisionOption.label) : null

  if (parts) {
    version.value = parts.version
    revision.value = parts.revision
  }
})

onMounted(() => {
  try {
    const stored = window.localStorage.getItem(languageStorageKey)

    if (stored !== null) {
      const parsed: unknown = JSON.parse(stored)

      if (Array.isArray(parsed)) {
        const languages = parsed
          .filter(isEditorLanguage)
          .filter((language, index, values) => values.indexOf(language) === index)

        if (languages.length > 0 || parsed.length === 0) {
          selectedLanguages.value = languages
        }
      }
    }
  } catch {
    // Ignore unavailable or malformed browser storage and keep the defaults.
  } finally {
    languageStorageReady.value = true
  }
})

watch(selectedLanguages, (value) => {
  if (!languageStorageReady.value) {
    return
  }

  try {
    window.localStorage.setItem(languageStorageKey, JSON.stringify(value))
  } catch {
    // Ignore browsers that block localStorage access.
  }
}, { deep: true })

watch([search, category, revisionId, version, revision, untranslatedOnly], () => {
  if (!applyingRouteQuery && page.value !== 1) {
    page.value = 1
  }
})

function getEditorRouteQuery(): Record<string, string> {
  const query: Record<string, string> = {}

  if (search.value) {
    query.search = search.value
  }

  if (itemId.value) {
    query.itemId = itemId.value
  }

  if (editRequested.value) {
    query.edit = 'true'
  }

  if (version.value && revision.value) {
    query.version = normalizeVersion(version.value)
    query.revision = normalizeRevision(revision.value)
  } else if (category.value && category.value !== EDITOR_ALL_CATEGORY_VALUE) {
    query.file = category.value
  }

  if (untranslatedOnly.value) {
    query.untranslated = 'true'
  }

  if (page.value > 1) {
    query.page = String(page.value)
  }

  return query
}

function syncEditorRouteQuery() {
  if (applyingRouteQuery) {
    return
  }

  const nextQuery = getEditorRouteQuery()
  const currentQuery = {
    search: getQueryString(route.query.search),
    itemId: getQueryString(route.query.itemId),
    edit: getQueryString(route.query.edit),
    file: getQueryString(route.query.file),
    version: getQueryString(route.query.version),
    revision: getQueryString(route.query.revision),
    untranslated: getQueryString(route.query.untranslated),
    page: getQueryString(route.query.page)
  }

  if (
    currentQuery.search === (nextQuery.search || '')
    && currentQuery.itemId === (nextQuery.itemId || '')
    && currentQuery.edit === (nextQuery.edit || '')
    && currentQuery.file === (nextQuery.file || '')
    && currentQuery.version === (nextQuery.version || '')
    && currentQuery.revision === (nextQuery.revision || '')
    && currentQuery.untranslated === (nextQuery.untranslated || '')
    && currentQuery.page === (nextQuery.page || '')
  ) {
    return
  }

  void router.push({ query: nextQuery })
}

watch([category, revisionId, version, revision, untranslatedOnly, page], syncEditorRouteQuery)

watch(search, () => {
  if (applyingRouteQuery) {
    return
  }

  if (searchQueryTimer) {
    clearTimeout(searchQueryTimer)
  }

  searchQueryTimer = setTimeout(() => {
    searchQueryTimer = undefined
    syncEditorRouteQuery()
  }, 300)
})

watch(
  () => [route.query.search, route.query.itemId, route.query.edit, route.query.file, route.query.version, route.query.revision, route.query.untranslated, route.query.page],
  () => {
    if (searchQueryTimer) {
      clearTimeout(searchQueryTimer)
      searchQueryTimer = undefined
    }

    applyingRouteQuery = true
    search.value = getQueryString(route.query.search)
    itemId.value = getQueryString(route.query.itemId)
    editRequested.value = getQueryBoolean(route.query.edit)
    version.value = normalizeVersion(getQueryString(route.query.version))
    revision.value = normalizeRevision(getQueryString(route.query.revision))
    category.value = version.value && revision.value
      ? EDITOR_ALL_CATEGORY_VALUE
      : getQueryString(route.query.file) || EDITOR_ALL_CATEGORY_VALUE
    revisionId.value = EDITOR_ALL_REVISION_VALUE
    untranslatedOnly.value = getQueryBoolean(route.query.untranslated)
    page.value = getQueryPage(route.query.page)

    nextTick(() => {
      applyingRouteQuery = false
    })
  }
)

onBeforeUnmount(() => {
  if (searchQueryTimer) {
    clearTimeout(searchQueryTimer)
  }
})

watch(totalPages, (value) => {
  if (page.value > value) {
    page.value = value
  }
})

watch(isLoading, (loading, wasLoading) => {
  if (wasLoading && !loading && import.meta.client) {
    nextTick(() => {
      window.scrollTo({ top: 0, behavior: 'auto' })
    })
  }
})

function resetFilters() {
  search.value = ''
  category.value = EDITOR_ALL_CATEGORY_VALUE
  version.value = ''
  revision.value = ''
  revisionId.value = EDITOR_ALL_REVISION_VALUE
  selectedLanguages.value = getAllLanguages()
  untranslatedOnly.value = false
  page.value = 1
}

function isEditing(itemId: string): boolean {
  return editingItemId.value === itemId
}

function startEdit(item: EditorItem) {
  if (!canEdit.value || saving.value) {
    return
  }

  editingItemId.value = item.id
  originalKo.value = item.ko
  draftKo.value = item.ko
  editError.value = ''
}

let focusedItemId: string | null = null

function focusRequestedItem() {
  const requestedItemId = itemId.value

  if (!requestedItemId || editorStatus.value !== 'success') {
    return
  }

  const item = items.value.find(value => value.id === requestedItemId)

  if (!item) {
    return
  }

  if (focusedItemId !== requestedItemId) {
    focusedItemId = requestedItemId
    nextTick(() => {
      if (!import.meta.client) {
        return
      }

      document.getElementById(`editor-item-${requestedItemId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    })
  }

  if (editRequested.value && canEdit.value && editingItemId.value !== requestedItemId) {
    startEdit(item)
  }
}

watch([items, editorStatus, canEdit, itemId, editRequested], focusRequestedItem)

function cancelEdit() {
  editingItemId.value = null
  originalKo.value = ''
  draftKo.value = ''
  editError.value = ''
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  if ('status' in error && typeof error.status === 'number') {
    return error.status
  }

  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }

  return undefined
}

async function saveEdit(item: EditorItem) {
  if (!canEdit.value || editingItemId.value !== item.id || saving.value) {
    return
  }

  const text = draftKo.value.trim()

  if (!text) {
    editError.value = '한국어 번역은 비워 둘 수 없습니다.'
    return
  }

  editError.value = ''
  saving.value = true

  try {
    const response = await $fetch<EditorSaveResponse>(`/api/editor/items/${item.id}`, {
      method: 'PATCH',
      body: {
        text,
        expectedText: originalKo.value
      }
    })

    await refreshItems()
    cancelEdit()

    toast.add({
      title: response.changed ? '번역 수정이 저장되었습니다.' : '변경된 내용이 없습니다.',
      description: response.changed ? '관리자 승인 대기 상태로 등록되었습니다.' : undefined,
      color: response.changed ? 'success' : 'neutral',
      icon: response.changed ? 'i-tabler-check' : 'i-tabler-info-circle'
    })
  } catch (error: unknown) {
    if (getErrorStatus(error) === 409) {
      editError.value = '다른 사용자가 먼저 수정했습니다. 항목을 새로 불러온 뒤 다시 시도해 주세요.'
    } else if (getErrorStatus(error) === 401) {
      editError.value = '로그인한 사용자만 번역을 수정할 수 있습니다.'
    } else {
      editError.value = '번역을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    }
  } finally {
    saving.value = false
  }
}

function openHistory(itemId: string) {
  historyItemId.value = itemId
  historyReloadKey.value += 1
  historyOpen.value = true
}

watch(canEdit, (value) => {
  if (!value && editingItemId.value) {
    cancelEdit()
  }
})
</script>

<template>
  <div class="flex flex-1 flex-col lg:flex-row gap-6 px-2 pb-6 md:px-6 max-w-400 mx-auto">
    <section class="hidden lg:flex flex-col shrink-0 w-60">
      <div class="sticky top-19 pb-8 max-h-[calc(100dvh-4.8rem)]">
        <EditorFilterDesktop :search="search" :category="category" :category-items="categoryItems"
          :revision-id="revisionId" :revision-items="revisionItems" :selected-languages="selectedLanguages"
          :untranslated-only="untranslatedOnly" :page="displayedPage" :total-pages="totalPages" :loading="isLoading"
          @update:search="search = $event" @update:category="category = $event"
          @update:revision-id="revisionId = $event" @update:selected-languages="selectedLanguages = $event"
          @update:untranslated-only="untranslatedOnly = $event" @update:page="page = $event" />
      </div>
    </section>

    <section class="flex flex-1 flex-col gap-4">
      <div v-if="hasError && !items.length" class="rounded-xl border border-error/30 bg-error/10 p-4">
        <UAlert color="error" variant="soft" title="에디터 데이터를 불러오지 못했습니다." description="잠시 후 다시 시도해 주세요." />
      </div>

      <UAlert v-else-if="!isLoading && !items.length" color="neutral" variant="soft" icon="i-tabler-search-off"
        title="조건에 맞는 항목이 없습니다." description="검색어나 필터 조건을 바꿔 보세요." />

      <template v-else-if="items.length">
        <div class="flex items-center justify-between text-xs">
          <span class="px-4 py-2 bg-muted rounded-xl">{{ total.toLocaleString() }}개 항목</span>
          <span class="px-4 py-2 bg-muted rounded-xl">{{ displayedPage }} / {{ totalPages }} 페이지</span>
        </div>

        <div v-for="item in items" :id="`editor-item-${item.id}`" :key="item.id"
          class="flex flex-col bg-muted rounded-xl px-2">
          <div class="flex items-center gap-4 p-4">
            <span class="text-base font-semibold">{{ item.category }}</span>
            <span class="text-sm font-medium text-muted">{{ item.unitKey }}</span>
          </div>

          <div class="flex flex-col gap-3 text-sm rounded-lg bg-default/50 p-4">
            <div v-for="language in visibleLanguageItems" :key="language.key" class="flex gap-4">
              <span class="w-20 text-right text-muted font-medium shrink-0">{{ language.label }}</span>
              <span class="whitespace-pre-wrap wrap-break-word">{{ item[language.key] || '—' }}</span>
            </div>
            <div class="flex gap-4">
              <span class="w-20 text-right text-muted font-medium shrink-0">한국어</span>
              <UTextarea v-if="isEditing(item.id)" v-model="draftKo" color="neutral" variant="outline" autoresize
                :disabled="saving" placeholder="한국어 번역" :ui="{ base: 'bg-transparent' }" class="w-full" />
              <div v-else class="min-w-0 flex-1">
                <p class="whitespace-pre-wrap wrap-break-word">
                  {{ item.ko || '미번역' }}
                </p>
                <UBadge v-if="item.pendingStatus === 'pending'" color="warning" variant="soft" class="mt-2">
                  승인 대기
                </UBadge>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-2 p-3">
            <p v-if="isEditing(item.id) && editError" class="text-right text-xs text-error">
              {{ editError }}
            </p>

            <div class="flex justify-end gap-2">
              <UButton icon="i-tabler-history" color="neutral" variant="soft" size="md" class="px-4 rounded-xl"
                @click="openHistory(item.id)">
                변경 기록
              </UButton>

              <template v-if="isEditing(item.id)">
                <UButton icon="i-tabler-x" color="neutral" variant="ghost" size="md" class="px-4 rounded-xl"
                  :disabled="saving" @click="cancelEdit">
                  취소
                </UButton>
                <UButton icon="i-tabler-device-floppy" color="info" variant="soft" size="md" class="px-4 rounded-xl"
                  :loading="saving" @click="saveEdit(item)">
                  저장
                </UButton>
              </template>

              <UButton v-else-if="canEdit" icon="i-tabler-edit" color="info" variant="soft" size="md"
                class="px-4 rounded-xl" @click="startEdit(item)">
                번역 수정
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </section>

    <USlideover v-model:open="historyOpen" side="right" inset :ui="{ content: 'max-w-2xl' }">
      <template #content>
        <EditorChangeHistory :item-id="historyItemId" :reload-key="historyReloadKey" @changed="refreshItems" />
      </template>
    </USlideover>

    <div v-if="isLoading" class="fixed size-100 z-100 flex items-center justify-center bg-default/30 backdrop-blur-sm"
      role="status" aria-live="polite" aria-label="데이터를 불러오는 중">
      <UIcon name="i-tabler-loader-2" class="size-10 animate-spin text-default" />
      <span class="sr-only">데이터를 불러오는 중입니다.</span>
    </div>

    <section class="w-fit mx-auto lg:hidden sticky bottom-2 bg-elevated/60 backdrop-blur-lg rounded-xl p-1">
      <EditorFilterMobile :search="search" :category="category" :category-items="categoryItems"
        :revision-id="revisionId" :revision-items="revisionItems" :selected-languages="selectedLanguages"
        :untranslated-only="untranslatedOnly" :page="displayedPage" :total-pages="totalPages" :loading="isLoading"
        @update:search="search = $event" @update:category="category = $event" @update:revision-id="revisionId = $event"
        @update:selected-languages="selectedLanguages = $event" @update:untranslated-only="untranslatedOnly = $event"
        @update:page="page = $event" @reset="resetFilters" />
    </section>
  </div>
</template>
