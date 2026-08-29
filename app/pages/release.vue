<script setup lang="ts">
import type {
  ReleaseFeedKey,
  ReleaseFeedResponse,
  ReleaseNoteEntry
} from '#shared/types/releases'

useHead({ title: '릴리즈 노트' })

const releaseTabs: Array<{ label: string, value: ReleaseFeedKey, icon: string }> = [
  { label: '버전', value: 'version', icon: 'i-tabler-package' },
  { label: 'AutoPatcher', value: 'autopatcher', icon: 'i-tabler-app-window' },
  { label: 'APK', value: 'apk', icon: 'i-tabler-brand-android' }
]

const activeTab = ref<ReleaseFeedKey>('version')
const expandedVersionDownloads = ref<Set<string>>(new Set())

function getReleaseKey(release: ReleaseNoteEntry): string {
  return `${release.id}:${release.tagName}`
}

function isVersionDownloadExpanded(release: ReleaseNoteEntry): boolean {
  return expandedVersionDownloads.value.has(getReleaseKey(release))
}

function toggleVersionDownload(release: ReleaseNoteEntry): void {
  const key = getReleaseKey(release)
  const next = new Set(expandedVersionDownloads.value)

  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }

  expandedVersionDownloads.value = next
}
const {
  data: releaseFeed,
  status,
  error,
  refresh
} = await useFetch<ReleaseFeedResponse>('/api/releases')

const activeReleases = computed<ReleaseNoteEntry[]>(() => {
  const releases = releaseFeed.value?.releases
  if (!releases) {
    return []
  }

  const current = releases[activeTab.value]
  if (current) {
    return current
  }

  if (activeTab.value !== 'version') {
    return []
  }

  const legacyReleases = releases as unknown as Partial<Record<'int_steam' | 'cn_steam' | 'int_android', ReleaseNoteEntry[]>>
  const merged = [
    ...(legacyReleases.int_steam ?? []),
    ...(legacyReleases.cn_steam ?? []),
    ...(legacyReleases.int_android ?? [])
  ]

  return [...new Map(merged.map(release => [release.id, release])).values()]
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
})

onBeforeUnmount(() => {
  if (relativeTimeTimer) {
    clearInterval(relativeTimeTimer)
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

function reloadReleases(): void {
  void refresh()
}
</script>

<template>
  <div class="flex flex-col gap-5 h-full max-w-6xl mx-auto">
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
        trigger: 'h-8 flex-1 justify-center px-3 leading-4 md:flex-none'
      }"
      @update:model-value="updateActiveTab"
    />

    <div class="flex items-center justify-between gap-3 text-sm">
      <div class="flex min-w-0 items-center gap-2">
        <span class="font-medium text-default">{{ activeTabLabel }}</span>
        <span class="text-muted">{{ formatCount(activeReleases.length) }}개 릴리즈</span>
      </div>
      <UTooltip
        v-if="releaseFeed?.fetchedAt"
        :text="formatDate(releaseFeed.fetchedAt)"
        :delay-duration="0"
      >
        <span class="hidden shrink-0 cursor-help text-xs text-dimmed sm:inline">
          마지막 갱신: {{ formatFetchedAgo(releaseFeed.fetchedAt) }}
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
      v-else-if="!activeReleases.length"
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
              v-if="activeTab === 'version'"
              type="button"
              class="flex w-full items-center justify-between gap-3 border-b border-default p-3 text-left transition-colors hover:bg-elevated/50"
              :aria-expanded="isVersionDownloadExpanded(release)"
              @click="toggleVersionDownload(release)"
            >
              <span class="text-xs font-medium text-muted">다운로드</span>
              <UIcon
                name="i-tabler-chevron-up"
                class="size-4 shrink-0 text-dimmed transition-transform"
                :class="isVersionDownloadExpanded(release) ? '' : 'rotate-180'"
              />
            </button>
            <div
              v-else
              class="flex p-3 border-b border-default"
            >
              <span class="text-xs font-medium text-muted">다운로드</span>
            </div>
            <div
              v-if="activeTab !== 'version' || isVersionDownloadExpanded(release)"
              class="flex flex-col"
            >
              <a
                v-for="asset in release.assets"
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
    </div>
  </div>
</template>
