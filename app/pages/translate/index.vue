<script setup lang="ts">
import {
  EDITOR_PROGRESS_STATUSES,
  type EditorOverviewResponse,
  type EditorProgressCounts,
  type EditorProgressStatus
} from '#shared/types/editor-overview'

interface ProgressSegment {
  status: EditorProgressStatus
  percentage: number
  isLast: boolean
}

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

const visibleStatuses: EditorProgressStatus[] = ['success', 'info', 'warning']

const statusMeta: Record<EditorProgressStatus, {
  label: string
  color: string
}> = {
  success: {
    label: '번역 완료',
    color: 'bg-[#5eba6e]'
  },
  info: {
    label: '승인 대기',
    color: 'bg-[#578fff]'
  },
  warning: {
    label: '확인 필요',
    color: 'bg-[#baba5e]'
  },
  untranslated: {
    label: '미번역',
    color: 'bg-elevated'
  }
}

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

function getProgressSegments(counts: EditorProgressCounts, total: number): ProgressSegment[] {
  const segments = EDITOR_PROGRESS_STATUSES
    .filter(status => counts[status] > 0)
    .map(status => ({
      status,
      percentage: total > 0 ? (counts[status] / total) * 100 : 0
    }))

  return segments.map((segment, index) => ({
    ...segment,
    isLast: index === segments.length - 1
  }))
}

function formatPercent(count: number, total: number): string {
  if (!total) {
    return '0.0%'
  }

  const percentage = (count / total) * 100

  if (count > 0 && percentage < 0.1) {
    return '<0.1%'
  }

  return `${percentage.toFixed(1)}%`
}

function formatCount(value: number): string {
  return value.toLocaleString('ko-KR')
}

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
  <ClientOnly>
    <div v-if="hasError" class="flex flex-col px-5">
      <UAlert class="mt-5" color="error" variant="soft" title="에디터 진행 상황을 불러오지 못했습니다." description="잠시 후 다시 시도해 주세요.">
        <template #actions>
          <UButton size="sm" color="error" variant="outline" @click="refreshOverview()">다시 시도</UButton>
        </template>
      </UAlert>
    </div>

    <div v-else-if="isLoading" class="flex items-center justify-center h-full">
      <UIcon name="i-tabler-loader-2" class="size-8 md:size-10 animate-spin" />
    </div>

    <div v-else class="flex flex-col h-full">
      <div class="flex items-center justify-between gap-5 pt-5 pb-2 px-5">
        <h1 class="text-xl md:text-2xl font-semibold">번역 에디터</h1>

        <div class="flex items-end md:items-center gap-4 px-3 py-2 bg-elevated rounded-md">
          <!-- 전체 상태별 비율 -->
          <div class="hidden sm:flex gap-3 shrink-0">
            <div v-for="status in visibleStatuses" :key="status" class="flex items-center gap-1 text-xs font-mono"
              :title="statusMeta[status].label">
              <div class="size-1.5 rounded-full" :class="statusMeta[status].color" />
              <span class="w-10 shrink-0">{{ formatPercent(overview.overall[status], overview.overall.total) }}</span>
            </div>
          </div>

          <div class="flex items-center gap-4">
            <!-- 전체 진행도 바 -->
            <UPopover mode="hover" enable-touch :content="{ side: 'top', align: 'center', sideOffset: 8 }">
              <div class="w-20 sm:w-24 h-2.5 flex bg-elevated rounded-xl relative overflow-hidden shrink-0"
                aria-label="전체 번역 진행률" role="img">
                <div class="absolute inset-0 flex">
                  <div v-for="segment in getProgressSegments(overview.overall, overview.overall.total)"
                    :key="segment.status" class="h-full shrink-0" :class="[
                      statusMeta[segment.status].color,
                      segment.isLast ? '' : 'border-r-2 border-default'
                    ]" :style="{ width: `${segment.percentage}%` }" />
                </div>
              </div>

              <template #content>
                <div class="w-64 max-w-[calc(100vw-2rem)] p-3 text-xs">
                  <div class="flex items-center justify-between gap-4">
                    <h3 class="min-w-0 truncate text-sm font-semibold">전체 진행도</h3>
                    <span class="font-mono text-muted shrink-0">
                      {{ formatPercent(overview.overall.success, overview.overall.total) }}
                    </span>
                  </div>

                  <div class="mt-3 flex items-center justify-between border-t border-default pt-3">
                    <span class="text-muted">완료 항목</span>
                    <span class="font-mono">
                      {{ formatCount(overview.overall.success) }} / {{ formatCount(overview.overall.total) }}
                    </span>
                  </div>

                  <div class="mt-3 flex flex-col gap-2 border-t border-default pt-3">
                    <div v-for="status in EDITOR_PROGRESS_STATUSES" :key="status"
                      class="flex items-center justify-between gap-4">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="size-1.5 shrink-0 rounded-full" :class="statusMeta[status].color" />
                        <span class="truncate text-muted">{{ statusMeta[status].label }}</span>
                      </div>
                      <div class="shrink-0 text-right font-mono flex">
                        <span>{{ formatCount(overview.overall[status]) }}</span>
                        <span class="mx-1.5">·</span>
                        <span class="w-10">{{ formatPercent(overview.overall[status], overview.overall.total) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </UPopover>

            <!-- 전체 항목 갯수 -->
            <span class="text-xs font-mono w-12 shrink-0">{{ formatCount(overview.overall.total) }}</span>
          </div>
        </div>
      </div>

      <div class="flex flex-col md:flex-row gap-3 py-3 px-5">
        <!-- 목록 옵션 -->
        <UTabs v-model="listMode" :content="false" :items="items" color="neutral" size="xs" :ui="{ trigger: 'px-3' }"
          class="w-fit" />

        <div class="flex flex-1 justify-between gap-3">
          <!-- 파일 검색 -->
          <UInput v-model="fileSearchValue" icon="i-tabler-search" color="neutral" variant="soft"
            :placeholder="listMode === 'category' ? '파일 검색' : '버전 검색'"
            :ui="{ trailing: 'pe-1', leadingIcon: 'size-4' }">
            <template v-if="fileSearchValue?.length" #trailing>
              <UButton color="neutral" variant="link" size="sm" icon="i-tabler-x" aria-label="Clear input"
                @click="fileSearchValue = ''" />
            </template>
          </UInput>

          <!-- 전체 번역 -->
          <UButton to="/translate/editor" color="info" variant="soft" class="px-4 shrink-0">전체 번역</UButton>
        </div>
      </div>

      <div v-if="!visibleRows.length" class="flex flex-1 items-center justify-center">
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
              <div v-for="status in visibleStatuses" :key="status" class="flex items-center gap-1 text-xs font-mono"
                :title="statusMeta[status].label">
                <div class="size-1.5 rounded-full" :class="statusMeta[status].color" />
                <span class="w-10 shrink-0">{{ formatPercent(row.counts[status], row.total) }}</span>
              </div>
            </div>

            <!-- 파일 진행도 바 -->
            <UPopover mode="hover" enable-touch :content="{ side: 'top', align: 'center', sideOffset: 8 }">
              <div class="w-20 sm:w-32 lg:w-52 h-2.5 flex bg-elevated rounded-xl relative overflow-hidden"
                aria-label="파일 번역 진행률" role="img">
                <div class="absolute inset-0 flex">
                  <div v-for="segment in getProgressSegments(row.counts, row.total)" :key="segment.status"
                    class="h-full shrink-0" :class="[
                      statusMeta[segment.status].color,
                      segment.isLast ? '' : 'border-r-2 border-default'
                    ]" :style="{ width: `${segment.percentage}%` }" />
                </div>
              </div>

              <template #content>
                <div class="w-64 max-w-[calc(100vw-2rem)] p-3 text-xs">
                  <div class="flex items-center justify-between gap-4">
                    <h3 class="min-w-0 truncate text-sm font-semibold">{{ row.label }}</h3>
                    <span class="font-mono text-muted shrink-0">
                      {{ formatPercent(row.counts.success, row.total) }}
                    </span>
                  </div>

                  <div class="mt-3 flex items-center justify-between border-t border-default pt-3">
                    <span class="text-muted">완료 항목</span>
                    <span class="font-mono">
                      {{ formatCount(row.counts.success) }} / {{ formatCount(row.total) }}
                    </span>
                  </div>

                  <div class="mt-3 flex flex-col gap-2 border-t border-default pt-3">
                    <div v-for="status in EDITOR_PROGRESS_STATUSES" :key="status"
                      class="flex items-center justify-between gap-4">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="size-1.5 shrink-0 rounded-full" :class="statusMeta[status].color" />
                        <span class="truncate text-muted">{{ statusMeta[status].label }}</span>
                      </div>
                      <div class="shrink-0 text-right font-mono flex">
                        <span>
                          {{ formatCount(row.counts[status]) }}
                        </span>
                        <span class="mx-1.5">·</span>
                        <span class="w-10">
                          {{ formatPercent(row.counts[status], row.total) }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </UPopover>

            <!-- 파일 내 항목 갯수 -->
            <span class="text-xs font-mono w-12 shrink-0">{{ formatCount(row.total) }}</span>
          </div>

        </div>
      </div>
    </div>

    <template #fallback>
      <div class="flex items-center justify-center h-full">
        <UIcon name="i-tabler-loader-2" class="size-8 md:size-10 animate-spin" />
      </div>
    </template>
  </ClientOnly>
</template>
