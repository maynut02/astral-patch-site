<script setup lang="ts">
import type {
  EditorOverviewResponse,
  EditorProgressCounts
} from '#shared/types/editor-overview'
import {
  EDITOR_STATUS_META,
  EDITOR_VISIBLE_STATUSES
} from '~/utils/editor-progress'
import { formatEditorCount, formatEditorPercent } from '~/utils/editor-helpers'

interface EditorListRow {
  key: string
  label: string
  total: number
  counts: EditorProgressCounts
  path?: string
}

type EditorListMode = 'category' | 'version'

const items = [
  { label: '파일', value: 'category' },
  { label: '버전', value: 'version' }
]

const route = useRoute()
const router = useRouter()

function getQueryString(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

function getListMode(value: unknown): EditorListMode {
  return getQueryString(value) === 'version' ? 'version' : 'category'
}

const listMode = ref<EditorListMode>(getListMode(route.query.view))

watch(listMode, (value) => {
  if (!import.meta.client || getQueryString(route.query.view) === value) {
    return
  }

  void router.replace({
    query: {
      ...route.query,
      view: value
    }
  })
})

watch(() => route.query.view, (value) => {
  const nextMode = getListMode(value)

  if (listMode.value !== nextMode) {
    listMode.value = nextMode
  }
}, { immediate: true })

onMounted(() => {
  if (getQueryString(route.query.view) === listMode.value) {
    return
  }

  void router.replace({
    query: {
      ...route.query,
      view: listMode.value
    }
  })
})

const visibleStatuses = EDITOR_VISIBLE_STATUSES

function createDefaultOverview(): EditorOverviewResponse {
  return {
    overall: {
      total: 0,
      success: 0,
      info: 0,
      warning: 0,
      untranslated: 0
    },
    categories: [],
    versions: []
  }
}

const fileSearchValue = ref('')

const {
  data: overviewData,
  status: overviewStatus,
  error: overviewError,
  refresh: refreshOverview
} = useFetch<EditorOverviewResponse>('/api/editor/overview', {
  server: false,
  lazy: true,
  default: createDefaultOverview
})

const overview = computed(() => overviewData.value ?? createDefaultOverview())
const isLoading = computed(() => overviewStatus.value === 'idle' || overviewStatus.value === 'pending')
const hasError = computed(() => Boolean(overviewError.value))

function getVersionLabel(version: string, revision: string): string {
  const normalizedVersion = version.replace(/^v/i, '')
  const normalizedRevision = revision.replace(/^r/i, '')

  return `v${normalizedVersion} · r${normalizedRevision}`
}

const filteredCategories = computed(() => {
  const query = fileSearchValue.value.trim().toLowerCase()

  if (!query) {
    return overview.value.categories
  }

  return overview.value.categories.filter(category => category.category.toLowerCase().includes(query))
})

const filteredVersions = computed(() => {
  const query = fileSearchValue.value.trim().toLowerCase()

  if (!query) {
    return overview.value.versions
  }

  return overview.value.versions.filter(version =>
    getVersionLabel(version.version, version.revision).toLowerCase().includes(query)
  )
})

const visibleRows = computed<EditorListRow[]>(() => {
  if (listMode.value === 'version') {
    return filteredVersions.value.map(version => ({
      key: `version:${version.id}`,
      label: getVersionLabel(version.version, version.revision),
      total: version.total,
      counts: version.counts,
      path: getVersionPath(version.version, version.revision)
    }))
  }

  return filteredCategories.value.map(category => ({
    key: `category:${category.category}`,
    label: category.category,
    total: category.total,
    counts: category.counts,
    path: getCategoryPath(category.category)
  }))
})

const hasRowsForMode = computed(() => listMode.value === 'category'
  ? overview.value.categories.length > 0
  : overview.value.versions.length > 0)

function getCategoryPath(category: string): string {
  return `/translate/editor?file=${encodeURIComponent(category)}`
}

function getVersionPath(version: string, revision: string): string {
  const normalizedVersion = version.replace(/^v/i, '')
  const normalizedRevision = revision.replace(/^r/i, '')

  return `/translate/editor?version=${encodeURIComponent(normalizedVersion)}&revision=${encodeURIComponent(normalizedRevision)}`
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center justify-between gap-5 pt-5 px-3 md:px-5">
      <h1 class="text-xl md:text-2xl font-semibold">
        번역 에디터
      </h1>

      <ClientOnly>
        <div v-if="!hasError && !isLoading" class="flex items-center gap-4 px-3 h-7 md:h-8 bg-muted rounded-md">
          <!-- 전체 상태별 비율 -->
          <div class="hidden sm:flex gap-3 shrink-0">
            <UTooltip v-for="status in visibleStatuses" :key="status" :text="EDITOR_STATUS_META[status].label">
              <div class="flex items-center gap-1 text-xs font-mono">
                <div class="size-1.5 rounded-full" :class="EDITOR_STATUS_META[status].color" />
                <span class="w-10 shrink-0">
                  {{ formatEditorPercent(overview.overall[status], overview.overall.total) }}
                </span>
              </div>
            </UTooltip>
          </div>

          <div class="flex items-center gap-4">
            <!-- 전체 진행도 바 -->
            <TranslationProgressPopover label="전체 진행도" :counts="overview.overall" :total="overview.overall.total"
              size="overall" aria-label="전체 번역 진행률" />

            <!-- 전체 항목 갯수 -->
            <span class="w-12 shrink-0 text-xs font-mono">
              {{ formatEditorCount(overview.overall.total) }}
            </span>
          </div>
        </div>

        <USkeleton v-else-if="isLoading" class="h-7 md:h-8 min-w-32 md:min-w-88 rounded-md" />

        <template #fallback>
          <USkeleton class="h-7 md:h-8 min-w-32 md:min-w-88 rounded-md" />
        </template>
      </ClientOnly>
    </div>

    <div class="flex flex-col md:flex-row gap-3 py-3 px-3 md:px-5">
      <!-- 목록 옵션 -->
      <UTabs v-model="listMode" :content="false" :items="items" color="neutral" size="xs"
        :ui="{ trigger: 'px-3', list: 'bg-muted' }" class="w-fit" />

      <div class="flex flex-1 justify-between gap-3">
        <!-- 파일 검색 -->
        <UInput v-model="fileSearchValue" type="search" icon="i-tabler-search" color="neutral" variant="soft"
          :aria-label="listMode === 'category' ? '파일 검색' : '버전 검색'"
          :placeholder="listMode === 'category' ? '파일 검색' : '버전 검색'" :ui="{ trailing: 'pe-1', leadingIcon: 'size-4' }">
          <template v-if="fileSearchValue.length" #trailing>
            <UButton color="neutral" variant="link" size="sm" icon="i-tabler-x" aria-label="검색어 지우기"
              @click="fileSearchValue = ''" />
          </template>
        </UInput>

        <!-- 전체 번역 -->
        <UButton to="/translate/editor" color="info" variant="soft" class="px-4 shrink-0">
          전체 번역
        </UButton>
      </div>
    </div>

    <ClientOnly>
      <div v-if="hasError" class="flex flex-col px-5">
        <UAlert class="mt-2" color="error" variant="soft" title="에디터 진행 상황을 불러오지 못했습니다." description="잠시 후 다시 시도해 주세요.">
          <template #actions>
            <UButton size="sm" color="error" variant="outline" @click="refreshOverview()">
              다시 시도
            </UButton>
          </template>
        </UAlert>
      </div>

      <div v-else-if="isLoading" class="flex flex-1 justify-center pt-5">
        <AppLoadingSpinner class="text-muted" />
      </div>

      <div v-else-if="!visibleRows.length" class="flex flex-1 items-center justify-center">
        <div class="flex flex-col items-center gap-2">
          <UIcon :name="listMode === 'category' ? 'i-tabler-file-off' : 'i-tabler-tag-off'" class="size-8" />
          <span class="text-base font-medium">
            {{ hasRowsForMode ? '검색 결과가 없습니다.' : listMode === 'category' ? '등록된 카테고리가 없습니다.' : '등록된 버전이 없습니다.' }}
          </span>
          <span class="text-sm text-muted">
            {{ hasRowsForMode ? (listMode === 'category' ? '다른 파일명을 검색해 보세요.' : '다른 버전을 검색해 보세요.') : listMode ===
              'category'
              ? '번역할 파일이 준비되면 이곳에 표시됩니다.' : '변경된 버전이 준비되면 이곳에 표시됩니다.' }}
          </span>
        </div>
      </div>

      <div v-else class="flex flex-col px-3 pb-5">
        <div v-for="row in visibleRows" :key="row.key"
          class="flex items-center first:border-t border-b border-default hover:bg-muted transition-colors">
          <!-- 파일명 -->
          <NuxtLink v-if="row.path" :to="row.path"
            class="flex flex-1 items-center gap-2 py-3 pl-2 md:pl-5 min-w-0 text-sm hover:underline underline-offset-2">
            <UIcon :name="listMode === 'category' ? 'i-tabler-file-filled' : 'i-tabler-tag-filled'"
              class="size-5 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
          </NuxtLink>

          <div v-else class="flex flex-1 items-center gap-2 py-3 pl-2 md:pl-5 min-w-0 text-sm">
            <UIcon :name="listMode === 'category' ? 'i-tabler-file-filled' : 'i-tabler-tag-filled'"
              class="size-5 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
          </div>

          <div class="flex items-center gap-4 px-2 md:px-5">
            <!-- 파일 상태별 비율 -->
            <div class="hidden sm:flex gap-3">
              <UTooltip v-for="status in visibleStatuses" :key="status" :text="EDITOR_STATUS_META[status].label">
                <div class="flex items-center gap-1 text-xs font-mono">
                  <div class="size-1.5 rounded-full" :class="EDITOR_STATUS_META[status].color" />
                  <span class="w-10 shrink-0">
                    {{ formatEditorPercent(row.counts[status], row.total) }}
                  </span>
                </div>
              </UTooltip>
            </div>

            <!-- 파일 진행도 바 -->
            <TranslationProgressPopover :label="row.label" :counts="row.counts" :total="row.total"
              aria-label="파일 번역 진행률" />

            <!-- 파일 내 항목 갯수 -->
            <span class="w-12 shrink-0 text-xs font-mono">
              {{ formatEditorCount(row.total) }}
            </span>
          </div>
        </div>
      </div>

      <template #fallback>
        <div class="flex flex-1 justify-center pt-5">
          <AppLoadingSpinner class="text-muted" />
        </div>
      </template>
    </ClientOnly>
  </div>
</template>
