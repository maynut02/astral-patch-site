<script setup lang="ts">
import type {
  EditorOverviewResponse,
  EditorProgressCounts
} from '#shared/types/editor-overview'
import {
  EDITOR_STATUS_META,
  EDITOR_VISIBLE_STATUSES
} from '~/utils/editor-progress'
import { formatEditorCount, formatEditorDate, formatEditorPercent } from '~/utils/editor-helpers'

interface EditorListRow {
  key: string
  label: string
  total: number
  counts: EditorProgressCounts
  path?: string
}

type EditorListMode = 'category' | 'version'

useAstralPageSeo('번역 대시보드')

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
const latestVersion = computed(() => overview.value.versions[0] ?? null)
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
  <div class="flex flex-col h-full max-w-400 mx-auto">
    <header class="flex flex-col gap-5">
      <div class="flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-tabler-language"
            class="size-5"
          />
          <h1 class="text-xl font-semibold -mt-0.75">
            번역 대시보드
          </h1>
        </div>

        <div class="flex items-center gap-2">
          <UButton
            to="/translate/editor"
            icon="i-tabler-arrow-right"
            color="info"
            variant="soft"
            size="md"
            class="px-3 shrink-0 flex-row-reverse self-start"
          >
            번역하러 가기
          </UButton>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div class="flex flex-1 flex-col gap-2 p-4 bg-muted border border-default">
          <span class="text-xs text-muted">최신 버전</span>
          <ClientOnly>
            <div
              v-if="isLoading"
              class="flex flex-col gap-1"
            >
              <USkeleton class="h-7 w-20" />
              <USkeleton class="h-4 w-28" />
            </div>
            <div
              v-else
              class="flex flex-col gap-1"
            >
              <span
                class="truncate text-xl font-semibold"
                :title="latestVersion ? getVersionLabel(latestVersion.version, latestVersion.revision) : undefined"
              >
                {{ latestVersion ? getVersionLabel(latestVersion.version, latestVersion.revision) : '—' }}
              </span>
              <time
                v-if="latestVersion"
                class="text-xs text-muted"
                :datetime="latestVersion.detectedAt"
              >
                {{ formatEditorDate(latestVersion.detectedAt) }}
              </time>
              <span
                v-else
                class="text-xs text-muted"
              >—</span>
            </div>
            <template #fallback>
              <div class="flex flex-col gap-1">
                <USkeleton class="h-7 w-20" />
                <USkeleton class="h-4 w-28" />
              </div>
            </template>
          </ClientOnly>
        </div>

        <div class="flex flex-1 flex-col gap-2 p-4 bg-muted border border-default">
          <span class="text-xs text-muted">전체 항목</span>
          <ClientOnly>
            <USkeleton
              v-if="isLoading"
              class="h-7 w-20"
            />
            <span
              v-else
              class="text-xl font-semibold"
            >
              {{ formatEditorCount(overview.overall.total) }}개
            </span>
            <template #fallback>
              <USkeleton class="h-7 w-20" />
            </template>
          </ClientOnly>
        </div>

        <div
          v-for="status in visibleStatuses"
          :key="status"
          class="flex flex-1 flex-col gap-2 p-4 bg-muted border border-default"
          :class="`dashboard-card--${status}`"
        >
          <span
            class="text-xs"
            :class="EDITOR_STATUS_META[status].textColor"
          >
            {{ EDITOR_STATUS_META[status].label }}
          </span>
          <ClientOnly>
            <div
              v-if="isLoading"
              class="flex flex-col gap-1"
            >
              <USkeleton class="h-7 w-20" />
              <USkeleton class="h-4 w-28" />
            </div>
            <div
              v-else
              class="flex flex-col gap-1"
            >
              <span class="text-xl font-medium">
                {{ formatEditorPercent(overview.overall[status], overview.overall.total) }}
              </span>
              <span class="text-xs text-muted">
                {{ formatEditorCount(overview.overall[status]) }}개
              </span>
            </div>
            <template #fallback>
              <div class="flex flex-col gap-1">
                <USkeleton class="h-7 w-20" />
                <USkeleton class="h-4 w-28" />
              </div>
            </template>
          </ClientOnly>
        </div>
      </div>

      <section class="flex flex-col gap-1 border border-default bg-muted p-1">
        <div class="flex flex-col gap-1 p-3">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 class="text-base font-semibold text-default">
              아스트랄 파티 한글화 가이드라인
            </h2>
            <UBadge
              color="neutral"
              variant="soft"
              size="sm"
            >
              1.0.0
            </UBadge>
          </div>
          <p class="text-sm text-muted">
            번역 등록 전 아래 기준을 확인해 주세요.
          </p>
        </div>

        <ol class="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
          <li class="flex flex-col gap-1 bg-default/50 p-3">
            <span class="text-sm font-semibold text-info">1. 자연스러운 번역</span>
            <p class="text-sm leading-6 text-toned">
              원문의 의미와 분위기를 유지하면서 자연스러운 한국어로 번역합니다. 불필요한 직역은 되도록 피합니다.
            </p>
          </li>
          <li class="flex flex-col gap-1 bg-default/50 p-3">
            <span class="text-sm font-semibold text-info">2. AI 번역</span>
            <p class="text-sm leading-6 text-toned">
              내장 기능을 포함한 AI 번역을 허용합니다. 단, 결과물을 그대로 제출하지 말고 원문과 대조하여 직접 검수해야 합니다.
            </p>
          </li>
          <li class="flex flex-col gap-1 bg-default/50 p-3">
            <span class="text-sm font-semibold text-info">3. 용어 통일</span>
            <p class="text-sm leading-6 text-toned">
              번역하기 전에 기존 번역 용어가 있는지 확인합니다. 기존 번역이 있다면 해당 용어를 우선 사용합니다.
            </p>
          </li>
          <li class="flex flex-col gap-1 bg-default/50 p-3">
            <span class="text-sm font-semibold text-info">4. 말투 통일</span>
            <p class="text-sm leading-6 text-toned">
              기본적인 말투는 존댓말로 통일합니다. 단, 캐릭터 대사는 원문에 나타난 성격과 관계를 우선하여 번역합니다.
            </p>
          </li>
          <li class="flex flex-col gap-1 bg-default/50 p-3">
            <span class="text-sm font-semibold text-info">5. 형식 보존</span>
            <p class="text-sm leading-6 text-toned">
              <code class="font-mono text-xs text-default">[Astral]</code>,
              <code class="font-mono text-xs text-default">[color]</code>,
              <code class="font-mono text-xs text-default">[size]</code> 등의 변수와 태그는 임의로 수정하지 마십시오. 수정하면 오류가 발생할 수 있습니다.
            </p>
          </li>
          <li class="flex flex-col gap-1 bg-default/50 p-3">
            <span class="text-sm font-semibold text-info">6. 검수 및 질문</span>
            <p class="text-sm leading-6 text-toned">
              최종 등록 전에 오탈자, 의미 오류, 용어 및 말투 불일치를 확인합니다. 의미가 불분명한 문장은 추측하지 말고 먼저 논의한 뒤 등록합니다.
            </p>
          </li>
        </ol>
      </section>

      <div class="flex items-center gap-3">
        <UTabs
          v-model="listMode"
          :content="false"
          :items="items"
          color="neutral"
          size="sm"
          :ui="{ trigger: 'h-7 leading-4 px-3', list: 'h-9 bg-elevated/50 p-1' }"
          class="w-fit"
        />

        <UInput
          v-model="fileSearchValue"
          type="search"
          icon="i-tabler-search"
          color="neutral"
          variant="soft"
          size="lg"
          :aria-label="listMode === 'category' ? '파일 검색' : '버전 검색'"
          :placeholder="listMode === 'category' ? '파일 검색' : '버전 검색'"
          class="h-9"
          :ui="{ base: 'h-9 leading-5', trailing: 'pe-1', leadingIcon: 'size-4' }"
        >
          <template
            v-if="fileSearchValue.length"
            #trailing
          >
            <UButton
              color="neutral"
              variant="link"
              size="sm"
              icon="i-tabler-x"
              aria-label="검색어 지우기"
              @click="fileSearchValue = ''"
            />
          </template>
        </UInput>
      </div>
    </header>

    <ClientOnly>
      <div
        v-if="hasError"
        class="flex flex-col pt-5"
      >
        <UAlert
          class="mt-2"
          color="error"
          variant="soft"
          title="에디터 진행 상황을 불러오지 못했습니다."
          description="잠시 후 다시 시도해 주세요."
        >
          <template #actions>
            <UButton
              size="sm"
              color="error"
              variant="outline"
              @click="refreshOverview()"
            >
              다시 시도
            </UButton>
          </template>
        </UAlert>
      </div>

      <div
        v-else-if="isLoading"
        class="flex flex-1 justify-center pt-5"
      >
        <AppLoadingSpinner class="text-muted" />
      </div>

      <div
        v-else-if="!visibleRows.length"
        class="flex flex-1 items-center justify-center pt-5"
      >
        <div class="flex flex-col items-center gap-2">
          <UIcon
            :name="listMode === 'category' ? 'i-tabler-file-off' : 'i-tabler-tag-off'"
            class="size-8"
          />
          <span class="text-base font-medium">
            {{ hasRowsForMode ? '검색 결과가 없습니다.' : listMode === 'category' ? '등록된 카테고리가 없습니다.' : '등록된 버전이 없습니다.' }}
          </span>
          <span class="text-sm text-muted">
            {{ hasRowsForMode ? (listMode === 'category' ? '다른 파일명을 검색해 보세요.' : '다른 버전을 검색해 보세요.') : listMode
              === 'category'
              ? '번역할 파일이 준비되면 이곳에 표시됩니다.' : '변경된 버전이 준비되면 이곳에 표시됩니다.' }}
          </span>
        </div>
      </div>

      <div
        v-else
        class="flex flex-col pt-5"
      >
        <div
          v-for="row in visibleRows"
          :key="row.key"
          class="flex items-center hover:bg-muted first:border-t border-b border-default transition-colors"
        >
          <NuxtLink
            v-if="row.path"
            :to="row.path"
            class="flex flex-1 items-center gap-2 py-3 pl-2 md:pl-3 min-w-0 text-sm hover:underline underline-offset-2"
          >
            <UIcon
              :name="listMode === 'category' ? 'i-tabler-file-filled' : 'i-tabler-tag-filled'"
              class="size-5 shrink-0 text-muted"
            />
            <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
          </NuxtLink>

          <div
            v-else
            class="flex flex-1 items-center gap-2 py-3 pl-2 md:pl-3 min-w-0 text-sm"
          >
            <UIcon
              :name="listMode === 'category' ? 'i-tabler-file-filled' : 'i-tabler-tag-filled'"
              class="size-5 shrink-0 text-muted"
            />
            <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
          </div>

          <div class="flex items-center gap-4 pl-3 pr-1 md:pr-2">
            <div class="hidden sm:flex gap-3">
              <UTooltip
                v-for="status in visibleStatuses"
                :key="status"
                :text="`${EDITOR_STATUS_META[status].label} (${formatEditorCount(row.counts[status])}개)`"
              >
                <div class="flex items-center gap-1 text-xs font-mono">
                  <div
                    class="size-1.5 rounded-full"
                    :class="EDITOR_STATUS_META[status].color"
                  />
                  <span class="w-11 shrink-0">
                    {{ formatEditorPercent(row.counts[status], row.total) }}
                  </span>
                </div>
              </UTooltip>
            </div>

            <TranslationProgressPopover
              :label="row.label"
              :counts="row.counts"
              :total="row.total"
              aria-label="파일 번역 진행률"
            />

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
