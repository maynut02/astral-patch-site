<script setup lang="ts">
import type {
  ReleaseAssetInfo,
  ReleaseFeedResponse,
  ReleaseNoteEntry
} from '#shared/types/releases'

useAstralPageSeo('다운로드')

interface ReleaseAssetMatch {
  asset: ReleaseAssetInfo
  release: ReleaseNoteEntry
}

const {
  data: releaseFeed,
  status,
  error,
  refresh
} = await useFetch<ReleaseFeedResponse>('/api/releases')

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

function findAssetInRelease(release: ReleaseNoteEntry | null, assetName: string): ReleaseAssetMatch | null {
  if (!release) {
    return null
  }

  const expectedName = assetName.toLowerCase()
  const asset = release.assets.find(item => item.name.toLowerCase() === expectedName)
  return asset ? { asset, release } : null
}

const windowsPatcher = computed(() => releaseFeed.value?.distribution.windowsPatcher ?? null)
const androidPatcher = computed(() => releaseFeed.value?.distribution.androidPatcher ?? null)
const androidApk = computed(() => releaseFeed.value?.distribution.androidApk ?? null)
const latestPatchRelease = computed(() =>
  releaseFeed.value?.distribution.stablePatch?.release
  ?? releaseFeed.value?.releases.patch[0]
  ?? null
)
const latestPatchVersion = computed(() =>
  releaseFeed.value?.distribution.stablePatch?.patchVersion
  ?? latestPatchRelease.value?.tagName
  ?? null
)
const intSteamManual = computed(() => findAssetInRelease(latestPatchRelease.value, 'INT_STEAM_manual_patch.zip'))
const cnSteamManual = computed(() => findAssetInRelease(latestPatchRelease.value, 'CN_STEAM_manual_patch.zip'))
const intSteamManifest = computed(() => findAssetInRelease(latestPatchRelease.value, 'INT_STEAM_manifest.json'))
const cnSteamManifest = computed(() => findAssetInRelease(latestPatchRelease.value, 'CN_STEAM_manifest.json'))
const intAndroidManifest = computed(() => findAssetInRelease(latestPatchRelease.value, 'INT_ANDROID_manifest.json'))

const intSteamDownloadCount = computed(() => {
  if (!intSteamManual.value && !intSteamManifest.value) {
    return null
  }

  return (intSteamManual.value?.asset.downloadCount ?? 0)
    + (intSteamManifest.value?.asset.downloadCount ?? 0)
})
const cnSteamDownloadCount = computed(() => {
  if (!cnSteamManual.value && !cnSteamManifest.value) {
    return null
  }

  return (cnSteamManual.value?.asset.downloadCount ?? 0)
    + (cnSteamManifest.value?.asset.downloadCount ?? 0)
})
const intAndroidDownloadCount = computed(() => intAndroidManifest.value?.asset.downloadCount ?? null)
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

function launchWindowsPatcher(
  action: 'settings' | 'install' | 'remove',
  route?: 'INT_STEAM' | 'CN_STEAM' | 'INT_ANDROID'
): void {
  if (!import.meta.client) {
    return
  }

  const routeSuffix = route ? `/${route}` : ''
  window.location.href = `astral://${action}${routeSuffix}`
}

function launchAndroidPatcher(): void {
  if (!import.meta.client) {
    return
  }

  window.location.href = 'astralpatcher://install-latest'
}

function reloadReleases(): void {
  void refresh()
}
</script>

<template>
  <div class="mx-auto flex h-full w-full max-w-7xl flex-col gap-5">
    <header class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-tabler-download"
          class="size-5"
        />
        <h1 class="-mt-0.75 text-xl font-semibold">
          다운로드
        </h1>
      </div>
    </header>

    <div class="flex">
      <UTooltip
        v-if="releaseFeed?.fetchedAt"
        :text="formatDate(releaseFeed.fetchedAt)"
        :delay-duration="0"
      >
        <span class="shrink-0 cursor-help text-xs text-dimmed">
          마지막 갱신: {{ formatFetchedAgo(releaseFeed.fetchedAt) }}
        </span>
      </UTooltip>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="최신 다운로드 정보를 불러오지 못했습니다."
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

    <section class="flex flex-col gap-3">
      <span class="font-medium">
        패치 도구
      </span>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-3">
        <article class="flex flex-col gap-1 border border-default bg-muted">
          <div class="flex flex-col gap-5 p-5">
            <div class="flex flex-col">
              <UIcon name="i-tabler-app-window" class="size-7 md:size-8" />
              <span class="text-xs text-muted mt-3">AstralWindowsPatcher.exe</span>
              <span class="text-xl font-medium mt-1">Windows 패치 프로그램</span>
            </div>

            <div class="grid grid-cols-2 gap-x-2 gap-y-4">
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">버전</span>
                <span class="truncate text-sm">{{ windowsPatcher ? `v${windowsPatcher.index.version}` : '확인 중' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">릴리즈 시각</span>
                <span class="truncate text-sm">{{ windowsPatcher?.release ? formatDate(windowsPatcher.release.publishedAt) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">크기</span>
                <span class="text-sm">{{ windowsPatcher ? formatFileSize(windowsPatcher.index.size) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">다운로드</span>
                <span class="text-sm">{{ windowsPatcher?.asset ? formatCount(windowsPatcher.asset.downloadCount) : '—' }}</span>
              </div>
            </div>
          </div>

          <div class="flex flex-col p-2 bg-default/75 h-full">
            <UButton
              :href="windowsPatcher?.index.downloadUrl"
              :disabled="!windowsPatcher"
              external
              icon="i-tabler-download"
              color="info"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
            >
              Windows 패치 프로그램 다운로드
            </UButton>
            <UButton
              icon="i-tabler-settings"
              color="neutral"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
              @click="launchWindowsPatcher('settings')"
            >
              프로그램 설정 열기
            </UButton>
          </div>
        </article>

        <article class="flex flex-col gap-1 border border-default bg-muted">
          <div class="flex flex-col gap-5 p-5">
            <div class="flex flex-col">
              <UIcon name="i-tabler-device-mobile" class="size-7 md:size-8" />
              <span class="text-xs text-muted mt-3">AstralAndroidPatcher.apk</span>
              <span class="text-xl font-medium mt-1">Android 패치 앱</span>
            </div>

            <div class="grid grid-cols-2 gap-x-2 gap-y-4">
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">버전</span>
                <span class="truncate text-sm">{{ androidPatcher ? `v${androidPatcher.index.version}` : '확인 중' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">릴리즈 시각</span>
                <span class="truncate text-sm">{{ androidPatcher?.release ? formatDate(androidPatcher.release.publishedAt) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">크기</span>
                <span class="text-sm">{{ androidPatcher ? formatFileSize(androidPatcher.index.size) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">다운로드</span>
                <span class="text-sm">{{ androidPatcher?.asset ? formatCount(androidPatcher.asset.downloadCount) : '—' }}</span>
              </div>
            </div>
          </div>

          <div class="flex flex-col p-2 bg-default/75 h-full">
            <UButton
              :href="androidPatcher?.index.downloadUrl"
              disabled
              external
              icon="i-tabler-download"
              color="info"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
            >
              Android 패치 앱 다운로드
            </UButton>
          </div>
        </article>

        <article class="flex flex-col gap-1 border border-default bg-muted">
          <div class="flex flex-col gap-5 p-5">
            <div class="flex flex-col">
              <UIcon name="i-tabler-brand-android" class="size-7 md:size-8" />
              <span class="text-xs text-muted mt-3">AstralPartyKorean.apk</span>
              <span class="text-xl font-medium mt-1">Android 일본 버전 APK</span>
            </div>

            <div class="grid grid-cols-2 gap-x-2 gap-y-4">
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">게임 버전</span>
                <span class="truncate text-sm">{{ androidApk ? `v${androidApk.index.gameVersion}` : '확인 중' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">릴리즈 시각</span>
                <span class="truncate text-sm">{{ androidApk?.release ? formatDate(androidApk.release.publishedAt) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">크기</span>
                <span class="text-sm">{{ androidApk ? formatFileSize(androidApk.index.size) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">다운로드</span>
                <span class="text-sm">{{ androidApk?.asset ? formatCount(androidApk.asset.downloadCount) : '—' }}</span>
              </div>
            </div>
          </div>

          <div class="flex h-full flex-col bg-default/75 p-2">
            <UButton
              icon="i-tabler-brand-windows"
              color="info"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
              disabled
            >
              Windows 패치 프로그램으로 설치
            </UButton>
            <UButton
              icon="i-tabler-brand-android"
              color="info"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
              disabled
              @click="launchAndroidPatcher"
            >
              Android 패치 앱으로 설치
            </UButton>
            <UButton
              :href="androidApk?.index.downloadUrl"
              external
              icon="i-tabler-download"
              color="neutral"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
              disabled
            >
              Android 일본 버전 APK 다운로드
            </UButton>
          </div>
        </article>
      </div>
    </section>

    <section class="flex flex-col gap-3 mt-3">
      <span class="font-medium">
        패치 파일
      </span>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-3">
        <article class="flex flex-col gap-1 border border-default bg-muted">
          <div class="flex flex-col gap-5 p-5">
            <div class="flex flex-col">
              <UIcon
                name="i-tabler-brand-steam"
                class="size-7 md:size-8"
              />
              <span class="mt-3 text-xs text-muted">INT_STEAM</span>
              <span class="mt-1 text-xl font-medium">Steam 글로벌 버전</span>
            </div>

            <div class="grid grid-cols-2 gap-x-2 gap-y-4">
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">버전</span>
                <span class="truncate text-sm">{{ latestPatchVersion ?? '확인 중' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">릴리즈 시각</span>
                <span class="truncate text-sm">{{ latestPatchRelease ? formatDate(latestPatchRelease.publishedAt) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">크기</span>
                <span class="text-sm">{{ intSteamManual ? formatFileSize(intSteamManual.asset.size) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">다운로드</span>
                <span class="text-sm">{{ intSteamDownloadCount !== null ? formatCount(intSteamDownloadCount) : '—' }}</span>
              </div>
            </div>
          </div>

          <div class="flex h-full flex-col bg-default/75 p-2">
            <UButton
              icon="i-tabler-wand"
              color="info"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
              @click="launchWindowsPatcher('install', 'INT_STEAM')"
            >
              원클릭 한글패치 설치
            </UButton>
            <UButton
              icon="i-tabler-trash"
              color="error"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
              @click="launchWindowsPatcher('remove', 'INT_STEAM')"
            >
              원클릭 한글패치 삭제
            </UButton>
            <UButton
              :href="intSteamManual?.asset.downloadUrl"
              :disabled="!intSteamManual"
              external
              icon="i-tabler-file-zip"
              color="neutral"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
            >
              수동 패치 파일 다운로드
            </UButton>
          </div>
        </article>

        <article class="flex flex-col gap-1 border border-default bg-muted">
          <div class="flex flex-col gap-5 p-5">
            <div class="flex flex-col">
              <UIcon
                name="i-tabler-brand-steam"
                class="size-7 md:size-8"
              />
              <span class="mt-3 text-xs text-muted">CN_STEAM</span>
              <span class="mt-1 text-xl font-medium">Steam 중국 버전</span>
            </div>

            <div class="grid grid-cols-2 gap-x-2 gap-y-4">
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">버전</span>
                <span class="truncate text-sm">{{ latestPatchVersion ?? '확인 중' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">릴리즈 시각</span>
                <span class="truncate text-sm">{{ latestPatchRelease ? formatDate(latestPatchRelease.publishedAt) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">크기</span>
                <span class="text-sm">{{ cnSteamManual ? formatFileSize(cnSteamManual.asset.size) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">다운로드</span>
                <span class="text-sm">{{ cnSteamDownloadCount !== null ? formatCount(cnSteamDownloadCount) : '—' }}</span>
              </div>
            </div>
          </div>

          <div class="flex h-full flex-col bg-default/75 p-2">
            <UButton
              icon="i-tabler-wand"
              color="info"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
              @click="launchWindowsPatcher('install', 'CN_STEAM')"
            >
              원클릭 한글패치 설치
            </UButton>
            <UButton
              icon="i-tabler-trash"
              color="error"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
              @click="launchWindowsPatcher('remove', 'CN_STEAM')"
            >
              원클릭 한글패치 삭제
            </UButton>
            <UButton
              :href="cnSteamManual?.asset.downloadUrl"
              :disabled="!cnSteamManual"
              external
              icon="i-tabler-file-zip"
              color="neutral"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
            >
              수동 패치 파일 다운로드
            </UButton>
          </div>
        </article>

        <article class="flex flex-col gap-1 border border-default bg-muted">
          <div class="flex flex-col gap-5 p-5">
            <div class="flex flex-col">
              <UIcon
                name="i-tabler-brand-android"
                class="size-7 md:size-8"
              />
              <span class="mt-3 text-xs text-muted">INT_ANDROID</span>
              <span class="mt-1 text-xl font-medium">Android 일본 버전</span>
            </div>

            <div class="grid grid-cols-2 gap-x-2 gap-y-4">
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">버전</span>
                <span class="truncate text-sm">{{ latestPatchVersion ?? '확인 중' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">릴리즈 시각</span>
                <span class="truncate text-sm">{{ latestPatchRelease ? formatDate(latestPatchRelease.publishedAt) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">크기</span>
                <span class="text-sm">-</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">다운로드</span>
                <span class="text-sm">{{ intAndroidDownloadCount !== null ? formatCount(intAndroidDownloadCount) : '—' }}</span>
              </div>
            </div>
          </div>

          <div class="flex h-full flex-col bg-default/75 p-2">
            <UButton
              :href="intAndroidManifest?.asset.downloadUrl"
              :disabled="!intAndroidManifest"
              external
              icon="i-tabler-file-description"
              color="neutral"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
            >
              패치 매니페스트 다운로드
            </UButton>
          </div>
        </article>
      </div>
    </section>

    <div
      v-if="status === 'pending'"
      class="flex items-center gap-2 text-xs text-dimmed"
    >
      <UIcon
        name="i-tabler-loader-2"
        class="size-4 animate-spin"
      />
      최신 릴리즈 정보를 확인하고 있습니다.
    </div>
  </div>
</template>
