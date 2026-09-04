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

const installationGuideItems = [
  {
    label: 'Windows 패치 프로그램 설치 및 사용 방법',
    icon: 'i-tabler-app-window',
    value: 'windows-patcher',
    slot: 'windows-patcher'
  },
  {
    label: 'Android 패치 앱 설치 및 사용 방법',
    icon: 'i-tabler-brand-android',
    value: 'android-patcher',
    slot: 'android-patcher'
  }
]

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
const intAndroidManual = computed(() => findAssetInRelease(latestPatchRelease.value, 'INT_ANDROID_manual_patch.zip'))
const cnAndroidManual = computed(() => findAssetInRelease(latestPatchRelease.value, 'CN_ANDROID_manual_patch.zip'))
const intAndroidManifest = computed(() => findAssetInRelease(latestPatchRelease.value, 'INT_ANDROID_manifest.json'))
const cnAndroidManifest = computed(() => findAssetInRelease(latestPatchRelease.value, 'CN_ANDROID_manifest.json'))

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
const intAndroidDownloadCount = computed(() => {
  if (!intAndroidManual.value && !intAndroidManifest.value) {
    return null
  }

  return (intAndroidManual.value?.asset.downloadCount ?? 0)
    + (intAndroidManifest.value?.asset.downloadCount ?? 0)
})
const cnAndroidDownloadCount = computed(() => {
  if (!cnAndroidManual.value && !cnAndroidManifest.value) {
    return null
  }

  return (cnAndroidManual.value?.asset.downloadCount ?? 0)
    + (cnAndroidManifest.value?.asset.downloadCount ?? 0)
})
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
  route?: 'INT_STEAM' | 'CN_STEAM'
): void {
  if (!import.meta.client) {
    return
  }

  const routeSuffix = route ? `/${route}` : ''
  window.location.href = `astral://${action}${routeSuffix}`
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
              :disabled="!androidPatcher"
              external
              icon="i-tabler-download"
              color="info"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
            >
              Android 패치 앱 다운로드
            </UButton>
            <UButton
              href="https://astral.maynutlab.com/android"
              external
              icon="i-tabler-external-link"
              color="neutral"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
            >
              패치 앱 열기
            </UButton>
          </div>
        </article>

        <article />
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
                <span class="text-sm">{{ intAndroidManual ? formatFileSize(intAndroidManual.asset.size) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">다운로드</span>
                <span class="text-sm">{{ intAndroidDownloadCount !== null ? formatCount(intAndroidDownloadCount) : '—' }}</span>
              </div>
            </div>
          </div>

          <div class="flex h-full flex-col bg-default/75 p-2">
            <UButton
              :href="intAndroidManual?.asset.downloadUrl"
              :disabled="!intAndroidManual"
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
              <span class="mt-3 text-xs text-muted">CN_ANDROID</span>
              <span class="mt-1 text-xl font-medium">Android 중국 버전</span>
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
                <span class="text-sm">{{ cnAndroidManual ? formatFileSize(cnAndroidManual.asset.size) : '—' }}</span>
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-xs text-dimmed">다운로드</span>
                <span class="text-sm">{{ cnAndroidDownloadCount !== null ? formatCount(cnAndroidDownloadCount) : '—' }}</span>
              </div>
            </div>
          </div>

          <div class="flex h-full flex-col bg-default/75 p-2">
            <UButton
              :href="cnAndroidManual?.asset.downloadUrl"
              :disabled="!cnAndroidManual"
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

    <section class="mt-3 flex flex-col gap-3">
      <span class="font-medium">
        설치 및 사용 방법
      </span>

      <div class="border border-default bg-muted">
        <UAccordion
          :items="installationGuideItems"
          color="neutral"
          :ui="{
            trigger: 'px-3 py-4 sm:px-5',
            body: 'px-3 pb-5 sm:px-5'
          }"
        >
          <template #windows-patcher-body>
            <div class="flex flex-col gap-6 pt-1">
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                  <UIcon
                    name="i-tabler-check"
                    class="size-4 shrink-0 text-success"
                  />
                  게임 리소스 다운로드 필요
                </div>
              </div>

              <ol class="flex flex-col gap-5">
                <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                  <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">1</span>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-medium text-default">
                      게임 설치 및 리소스 준비
                    </h3>
                    <p class="text-sm leading-6 text-muted">
                      Steam에서 Astral Party를 설치합니다. 게임을 한 번 실행해 최신 리소스 다운로드를 완료한 뒤 게임을 종료해 주세요.
                    </p>
                  </div>
                </li>

                <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                  <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">2</span>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-medium text-default">
                      Windows 패치 프로그램 실행
                    </h3>
                    <p class="text-sm leading-6 text-muted">
                      다운로드한 AstralWindowsPatcher.exe를 실행합니다. 처음 실행하면 최신 프로그램 버전을 확인하고, 웹사이트의 원클릭 버튼과 연동할 수 있도록 프로그램을 등록합니다. 이후에는 다운로드한 파일을 다시 찾지 않아도 웹사이트에서 패처를 열 수 있습니다.
                    </p>
                  </div>
                </li>

                <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                  <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">3</span>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-medium text-default">
                      Steam 지역과 경로 확인
                    </h3>
                    <p class="text-sm leading-6 text-muted">
                      패처가 Steam 게임 경로와 리소스 경로를 자동으로 찾습니다. 경로를 찾지 못했거나 다른 버전을 사용한다면 ‘Steam 설정’에서 Steam 글로벌·중국 지역을 선택하고 ‘게임 경로 자동 찾기’를 실행해 주세요. 필요한 경우 두 경로를 직접 입력할 수도 있습니다.
                    </p>
                  </div>
                </li>

                <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                  <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">4</span>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-medium text-default">
                      한글패치 설치
                    </h3>
                    <p class="text-sm leading-6 text-muted">
                      다운로드 페이지에서 사용하는 버전의 ‘원클릭 한글패치 설치’를 누르거나, 프로그램에서 ‘Steam 패치 설치 / 업데이트’를 선택합니다. 호환 패치 확인, 다운로드, 원본 백업, 파일 검증과 적용이 자동으로 진행되므로 완료 메시지가 나올 때까지 프로그램을 종료하지 마세요.
                    </p>
                  </div>
                </li>

                <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                  <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">5</span>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-medium text-default">
                      업데이트 및 패치 제거
                    </h3>
                    <p class="text-sm leading-6 text-muted">
                      게임이나 한글패치가 업데이트되면 업데이트 작업을 다시 실행합니다. 한글패치를 제거하려면 웹사이트의 원클릭 삭제 버튼이나 프로그램의 ‘Steam 패치 제거’를 사용하면 원본 파일을 복원합니다.
                    </p>
                  </div>
                </li>
              </ol>

              <UAlert
                icon="i-tabler-help-filled"
                color="info"
                variant="soft"
                title="경로 탐지 또는 패치 제거에 실패한 경우"
                description="Steam 설정에서 경로를 다시 찾고, 게임 파일이 외부에서 변경되어 제거할 수 없다면 Steam 파일 무결성 검사를 완료한 뒤 다시 시도해 주세요."
              />
            </div>
          </template>

          <template #android-patcher-body>
            <div class="flex flex-col gap-6 pt-1">
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                  <UIcon
                    name="i-tabler-check"
                    class="size-4 shrink-0 text-success"
                  />
                  WIFI 필요
                </div>
                <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                  <UIcon
                    name="i-tabler-x"
                    class="size-4 shrink-0 text-error"
                  />
                  일본 Google 계정 불필요
                </div>
                <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                  <UIcon
                    name="i-tabler-x"
                    class="size-4 shrink-0 text-error"
                  />
                  VPN 불필요
                </div>
                <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                  <UIcon
                    name="i-tabler-x"
                    class="size-4 shrink-0 text-error"
                  />
                  PC 불필요
                </div>
              </div>

              <ol class="flex flex-col gap-5">
                <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                  <span class="flex size-7 md:size-8 items-center justify-center bg-elevated text-sm font-semibold">1</span>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-medium text-default">
                      패치 앱과 Shizuku 설치
                    </h3>
                    <p class="text-sm leading-6 text-muted">
                      Android 패치 앱을 설치해 실행한 뒤 Shizuku 설치 버튼을 누릅니다. 출처를 알 수 없는 앱 설치 권한을 요청하면 허용해 주세요. Shizuku 설정을 이미 완료했다면 4단계로 넘어가면 됩니다.
                    </p>
                  </div>
                </li>

                <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                  <span class="flex size-7 md:size-8 items-center justify-center bg-elevated text-sm font-semibold">2</span>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-medium text-default">
                      개발자 옵션과 디버깅 활성화
                    </h3>
                    <p class="text-sm leading-6 text-muted">
                      설정 → 스마트폰·태블릿 정보 → 소프트웨어 정보에서 빌드 번호를 연속으로 눌러 개발자 모드를 활성화합니다. 개발자 옵션에서 USB 디버깅과 무선 디버깅을 켜 주세요.
                    </p>
                  </div>
                </li>

                <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                  <span class="flex size-7 md:size-8 items-center justify-center bg-elevated text-sm font-semibold">3</span>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-medium text-default">
                      Shizuku 페어링 및 시작
                    </h3>
                    <p class="text-sm leading-6 text-muted">
                      Shizuku에서 페어링을 누르고 알림을 허용합니다. 개발자 옵션의 ‘페어링 코드로 기기 페어링’을 선택한 뒤, 알림창의 Shizuku 코드 입력란에 표시된 코드를 입력합니다. Shizuku로 돌아와 시작을 누르고 안내 창이 사라질 때까지 기다려 주세요.
                    </p>
                    <p class="text-xs leading-5 text-dimmed">
                      페어링 코드 방식은 Android 11 이상에서 사용할 수 있습니다.
                    </p>
                  </div>
                </li>

                <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                  <span class="flex size-7 md:size-8 items-center justify-center bg-elevated text-sm font-semibold">4</span>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-medium text-default">
                      패치 앱 권한 허용
                    </h3>
                    <p class="text-sm leading-6 text-muted">
                      Android 패치 앱으로 돌아와 권한 허용을 누른 뒤 ‘항상 허용’을 선택합니다. Shizuku 상태가 초록색이면 준비가 끝난 것입니다. 이 설정은 처음 한 번만 하면 되며, 초록색이 아니라면 페어링과 시작 과정을 다시 진행해 주세요.
                    </p>
                  </div>
                </li>

                <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                  <span class="flex size-7 md:size-8 items-center justify-center bg-elevated text-sm font-semibold">5</span>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-medium text-default">
                      게임 준비 및 한글패치 적용
                    </h3>
                    <p class="text-sm leading-6 text-muted">
                      패치 앱에서 게임 설치를 누르고, 설치가 끝나면 게임을 한 번 실행해 리소스 다운로드를 완료합니다. 다시 패치 앱으로 돌아와 한글패치 적용을 누르세요. 이미 완료된 항목은 초록색으로 표시되므로 건너뛰면 됩니다.
                    </p>
                  </div>
                </li>
              </ol>

              <UAlert
                icon="i-tabler-help-filled"
                color="info"
                variant="soft"
                title="게임 또는 한글패치가 업데이트된 경우"
                description="패치 앱에서 노란색으로 표시된 항목의 버튼만 누르면 필요한 항목을 자동으로 업데이트합니다."
              />

              <div class="flex justify-end">
                <UButton
                  href="https://arca.live/b/astralparty/181792057"
                  external
                  icon="i-tabler-external-link"
                  color="neutral"
                  variant="soft"
                  size="sm"
                >
                  이미지가 포함된 가이드 보기
                </UButton>
              </div>
            </div>
          </template>
        </UAccordion>
      </div>
    </section>
  </div>
</template>
