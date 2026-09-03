<script setup lang="ts">
import type {
  ReleaseFeedKey,
  ReleaseHistoryPageResponse,
  ReleaseNoteEntry
} from '#shared/types/releases'

useAstralPageSeo('릴리즈 노트')

const releaseTabs: Array<{ label: string, value: ReleaseFeedKey, icon: string }> = [
  { label: '한글패치', value: 'patch', icon: 'i-tabler-package' },
  { label: 'Windows 패치 프로그램', value: 'windowsPatcher', icon: 'i-tabler-brand-windows' },
  { label: 'Android 패치 앱', value: 'androidPatcher', icon: 'i-tabler-brand-android' }
]

const activeTab = ref<ReleaseFeedKey>('patch')
const expandedPatchDownloads = ref<Set<string>>(new Set())

function getReleaseKey(release: ReleaseNoteEntry): string {
  return `${release.id}:${release.tagName}`
}

function isPatchDownloadExpanded(release: ReleaseNoteEntry): boolean {
  return expandedPatchDownloads.value.has(getReleaseKey(release))
}

function togglePatchDownload(release: ReleaseNoteEntry): void {
  const key = getReleaseKey(release)
  const next = new Set(expandedPatchDownloads.value)

  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }

  expandedPatchDownloads.value = next
}
const {
  data: initialHistoryPage,
  status,
  error,
  refresh
} = await useFetch<ReleaseHistoryPageResponse>('/api/releases/history', {
  query: { page: 1 }
})

function createEmptyReleaseGroups(): Record<ReleaseFeedKey, ReleaseNoteEntry[]> {
  return {
    patch: [],
    windowsPatcher: [],
    androidPatcher: []
  }
}

const releases = ref<Record<ReleaseFeedKey, ReleaseNoteEntry[]>>(createEmptyReleaseGroups())
const fetchedAt = ref('')
const currentPage = ref(1)
const hasMore = ref(false)
const isLoadingMore = ref(false)
const loadMoreFailed = ref(false)
const loadMoreTrigger = ref<HTMLElement | null>(null)
let loadMoreObserver: IntersectionObserver | undefined

function sortReleaseEntries(entries: ReleaseNoteEntry[]): ReleaseNoteEntry[] {
  return entries.sort((left, right) => {
    const leftTime = new Date(left.publishedAt).getTime()
    const rightTime = new Date(right.publishedAt).getTime()
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
  })
}

function mergeReleaseEntries(
  current: ReleaseNoteEntry[],
  incoming: ReleaseNoteEntry[]
): ReleaseNoteEntry[] {
  const merged = new Map(current.map(release => [getReleaseKey(release), release]))

  for (const release of incoming) {
    merged.set(getReleaseKey(release), release)
  }

  return sortReleaseEntries([...merged.values()])
}

function applyHistoryPage(page: ReleaseHistoryPageResponse, replace = false): void {
  const next = replace ? createEmptyReleaseGroups() : { ...releases.value }

  for (const key of Object.keys(next) as ReleaseFeedKey[]) {
    next[key] = replace
      ? [...page.releases[key]]
      : mergeReleaseEntries(next[key], page.releases[key])
  }

  releases.value = next
  fetchedAt.value = page.fetchedAt
  currentPage.value = page.page
  hasMore.value = page.hasMore
  loadMoreFailed.value = false
}

watch(initialHistoryPage, (page) => {
  if (page) {
    applyHistoryPage(page, true)
  }
}, { immediate: true })

const activeReleases = computed<ReleaseNoteEntry[]>(() => {
  return releases.value[activeTab.value] ?? []
})

const activeTabLabel = computed(() =>
  releaseTabs.find(tab => tab.value === activeTab.value)?.label ?? '릴리즈'
)

const numberFormatter = new Intl.NumberFormat('ko-KR')
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Seoul'
})

const relativeTimeNow = ref<number | null>(null)
let relativeTimeTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  relativeTimeNow.value = Date.now()
  relativeTimeTimer = setInterval(() => {
    relativeTimeNow.value = Date.now()
  }, 1000)

  loadMoreObserver = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) {
      void loadMoreReleaseHistory()
    }
  }, {
    rootMargin: '400px 0px'
  })

  if (loadMoreTrigger.value) {
    loadMoreObserver.observe(loadMoreTrigger.value)
  }
})

onBeforeUnmount(() => {
  if (relativeTimeTimer) {
    clearInterval(relativeTimeTimer)
  }

  loadMoreObserver?.disconnect()
})

watch(loadMoreTrigger, (element, previousElement) => {
  if (!loadMoreObserver) {
    return
  }

  if (previousElement) {
    loadMoreObserver.unobserve(previousElement)
  }

  if (element) {
    loadMoreObserver.observe(element)
  }
})

function updateActiveTab(value: string | number): void {
  if (typeof value !== 'string') {
    return
  }

  if (releaseTabs.some(tab => tab.value === value)) {
    activeTab.value = value as ReleaseFeedKey
  }
}

function formatCount(value: number): string {
  return numberFormatter.format(value)
}

function formatDate(value: string): string {
  if (!value) {
    return '시간 정보 없음'
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '시간 정보 없음' : dateFormatter.format(date)
}

function formatFetchedAgo(value: string): string {
  if (!value) {
    return '시간 정보 없음'
  }

  const fetchedAt = new Date(value).getTime()
  if (Number.isNaN(fetchedAt)) {
    return '시간 정보 없음'
  }

  const now = relativeTimeNow.value ?? fetchedAt
  const elapsedSeconds = Math.max(0, Math.floor((now - fetchedAt) / 1000))

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}초 전`
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}분 전`
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `${elapsedHours}시간 전`
  }

  return `${Math.floor(elapsedHours / 24)}일 전`
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / (1024 ** unitIndex)
  const fractionDigits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2

  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}

function isManualSteamAsset(name: string): boolean {
  const lowerName = name.toLowerCase()
  return lowerName === 'int_steam_manual_patch.zip'
    || lowerName === 'cn_steam_manual_patch.zip'
}

function getVisibleAssets(release: ReleaseNoteEntry) {
  if (activeTab.value !== 'patch' || isPatchDownloadExpanded(release)) {
    return release.assets
  }

  return release.assets.filter(asset => isManualSteamAsset(asset.name))
}

function getAssetIcon(name: string): string {
  const lowerName = name.toLowerCase()

  if (lowerName.endsWith('.apk')) {
    return 'i-tabler-brand-android'
  }

  if (lowerName.endsWith('.exe')) {
    return 'i-tabler-brand-windows'
  }

  if (lowerName.endsWith('.json')) {
    return 'i-tabler-file-code'
  }

  if (lowerName.endsWith('.gz') || lowerName.endsWith('.zip')) {
    return 'i-tabler-file-zip'
  }

  return 'i-tabler-file'
}

async function loadMoreReleaseHistory(): Promise<void> {
  if (!hasMore.value || isLoadingMore.value) {
    return
  }

  isLoadingMore.value = true
  loadMoreFailed.value = false
  loadMoreObserver?.disconnect()

  try {
    const page = await $fetch<ReleaseHistoryPageResponse>('/api/releases/history', {
      query: { page: currentPage.value + 1 }
    })
    applyHistoryPage(page)
  } catch {
    loadMoreFailed.value = true
  } finally {
    isLoadingMore.value = false
    await nextTick()

    if (hasMore.value && loadMoreTrigger.value && loadMoreObserver) {
      loadMoreObserver.observe(loadMoreTrigger.value)
    }
  }
}

async function reloadReleases(): Promise<void> {
  loadMoreFailed.value = false
  await refresh()
}
</script>

<template>
  <div class="flex flex-col gap-5 h-full max-w-7xl mx-auto">
    <header class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-tabler-clipboard-check"
          class="size-5"
        />
        <h1 class="text-xl font-semibold -mt-0.75">
          릴리즈 노트
        </h1>
      </div>
    </header>

    <UTabs
      :model-value="activeTab"
      :items="releaseTabs"
      :content="false"
      color="neutral"
      size="sm"
      class="w-full md:w-fit"
      :ui="{
        list: 'w-full bg-elevated/50 p-1 md:w-fit',
        trigger: 'h-8 justify-center px-3 leading-4 md:flex-none'
      }"
      @update:model-value="updateActiveTab"
    />

    <div class="flex items-center justify-between gap-3 text-sm">
      <div class="flex min-w-0 items-center gap-2">
        <span class="font-medium text-default">{{ activeTabLabel }}</span>
        <span class="text-muted">{{ formatCount(activeReleases.length) }}개 릴리즈</span>
      </div>
      <UTooltip
        v-if="fetchedAt"
        :text="formatDate(fetchedAt)"
        :delay-duration="0"
      >
        <span class="shrink-0 cursor-help text-xs text-dimmed">
          마지막 갱신: {{ formatFetchedAgo(fetchedAt) }}
        </span>
      </UTooltip>
    </div>

    <div
      v-if="status === 'pending'"
      class="flex min-h-48 items-center justify-center text-muted"
    >
      <AppLoadingSpinner />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      title="릴리즈 정보를 불러오지 못했습니다."
      description="GitHub 연결 상태를 확인한 뒤 다시 시도해 주세요."
    >
      <template #actions>
        <UButton
          color="error"
          variant="soft"
          size="sm"
          @click="reloadReleases"
        >
          다시 불러오기
        </UButton>
      </template>
    </UAlert>

    <div
      v-else-if="!activeReleases.length && !hasMore"
      class="flex min-h-48 flex-col items-center justify-center border border-default p-6 text-center"
    >
      <UIcon
        name="i-tabler-history-off"
        class="size-7 text-dimmed"
      />
      <p class="mt-2 text-sm text-muted">
        표시할 릴리즈 기록이 없습니다.
      </p>
    </div>

    <div
      v-else
      class="flex flex-col gap-5"
    >
      <article
        v-for="release in activeReleases"
        :key="`${activeTab}-${release.id}-${release.tagName}`"
        class="flex flex-col bg-muted border border-default"
      >
        <div class="flex flex-col gap-2 border-b border-default p-3">
          <div class="flex flex-wrap items-center gap-2">
            <a
              :href="release.url"
              target="_blank"
              rel="noopener noreferrer"
              class="min-w-0 text-base font-semibold text-default hover:underline underline-offset-4"
            >
              {{ release.title }}
            </a>
            <UBadge
              v-if="release.prerelease"
              color="warning"
              variant="soft"
              size="xs"
            >
              Pre-release
            </UBadge>
          </div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span class="flex items-center gap-1">
              <UIcon
                name="i-tabler-clock"
                class="size-4"
              />
              <time :datetime="release.publishedAt">{{ formatDate(release.publishedAt) }}</time>
            </span>
          </div>
        </div>

        <section class="min-w-0 bg-default/75 p-3 md:p-5 border-b border-default">
          <ReleaseMarkdown :source="release.body" />
        </section>

        <div class="flex flex-col gap-5">
          <section
            v-if="release.assets.length"
            class="flex flex-col"
          >
            <button
              v-if="activeTab === 'patch'"
              type="button"
              class="flex w-full items-center justify-between gap-3 border-b border-default p-3 text-left transition-colors hover:bg-elevated/50"
              :aria-expanded="isPatchDownloadExpanded(release)"
              @click="togglePatchDownload(release)"
            >
              <span class="text-xs font-medium text-muted">다운로드</span>
              <UIcon
                name="i-tabler-chevron-up"
                class="size-4 shrink-0 text-dimmed transition-transform"
                :class="isPatchDownloadExpanded(release) ? '' : 'rotate-180'"
              />
            </button>
            <div
              v-else
              class="flex p-3 border-b border-default"
            >
              <span class="text-xs font-medium text-muted">다운로드</span>
            </div>
            <div
              v-if="getVisibleAssets(release).length"
              class="flex flex-col"
            >
              <a
                v-for="asset in getVisibleAssets(release)"
                :key="asset.id || asset.name"
                :href="asset.downloadUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="flex min-w-0 items-center gap-3 not-last:border-b border-default px-3 py-2 transition-colors hover:bg-elevated/70"
              >
                <UIcon
                  :name="getAssetIcon(asset.name)"
                  class="size-5 text-muted"
                />

                <span class="min-w-0 flex-1 flex flex-col gap-1">
                  <span class="block truncate text-sm font-medium text-default">{{ asset.name }}</span>
                  <span class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                    <div class="flex items-center gap-1">
                      <UIcon name="i-tabler-package" class="size-3 mt-px" />
                      <span class="release-asset-size">{{ formatFileSize(asset.size) }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <UIcon name="i-tabler-download" class="size-3 mt-px" />
                      <span class="release-asset-download-count">{{ formatCount(asset.downloadCount) }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <UIcon name="i-tabler-clock" class="size-3 mt-px" />
                      <span class="release-asset-date">{{ formatDate(asset.createdAt) }}</span>
                    </div>
                  </span>
                </span>
              </a>
            </div>
          </section>
        </div>
      </article>

      <div
        v-if="hasMore || isLoadingMore || loadMoreFailed"
        ref="loadMoreTrigger"
        class="flex min-h-16 items-center justify-center"
      >
        <UButton
          v-if="loadMoreFailed"
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-tabler-refresh"
          @click="loadMoreReleaseHistory"
        >
          다음 릴리즈 불러오기
        </UButton>
        <AppLoadingSpinner v-else />
      </div>
    </div>
  </div>
</template>
