<script setup lang="ts">
import HomeGuideStep from '~/components/HomeGuideStep.vue'
import type {
  EditorChangeStatus,
  EditorTranslationLogEntry,
  EditorTranslationLogResponse
} from '#shared/types/editor'
import type { EditorOverviewResponse } from '#shared/types/editor-overview'
import type {
  ReleaseAssetInfo,
  ReleaseFeedKey,
  ReleaseFeedResponse,
  ReleaseNoteEntry
} from '#shared/types/releases'
import type { GameLocalizedText, GameNotice, GameServerResponse } from '#shared/types/game-server'
import { getEditorDiffParts } from '~/utils/editor-diff'
import { formatEditorCount, formatEditorDate, formatEditorPercent } from '~/utils/editor-helpers'
import { EDITOR_STATUS_META, EDITOR_VISIBLE_STATUSES } from '~/utils/editor-progress'

type SupportedRoute = 'INT_STEAM' | 'CN_STEAM' | 'INT_ANDROID'
type GuideAnswerKey = 'route' | 'resources' | 'gameRemoved' | 'installMethod' | 'usbDebugging' | 'patcher' | 'started' | 'shizuku'

interface ReleaseAssetMatch {
  asset: ReleaseAssetInfo
  release: ReleaseNoteEntry
}

interface RecentReleaseEntry {
  feed: ReleaseFeedKey
  release: ReleaseNoteEntry
}

const RECENT_ITEM_LIMIT = 5

const releaseFeedLabels: Record<ReleaseFeedKey, string> = {
  patch: '한글패치',
  windowsPatcher: 'Windows 패치 프로그램',
  androidPatcher: 'Android 패치 앱',
  androidApk: 'Android 일본 버전 APK'
}

const changeStatusLabels: Record<EditorChangeStatus, string> = {
  pending: '승인 대기',
  approved: '승인됨',
  rejected: '반려됨',
  superseded: '자동 종료'
}

const changeStatusColors: Record<EditorChangeStatus, 'warning' | 'success' | 'error' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  superseded: 'neutral'
}

const routeOptions = [
  { label: 'Steam 글로벌', value: 'INT_STEAM', icon: 'i-tabler-brand-steam' },
  { label: 'Steam 중국', value: 'CN_STEAM', icon: 'i-tabler-brand-steam' },
  { label: 'Android 일본', value: 'INT_ANDROID', icon: 'i-tabler-brand-android' }
]
const yesNoOptions = [
  { label: '예', value: 'yes' },
  { label: '아니오', value: 'no' }
]
const patcherOptions = [
  { label: '예', value: 'yes' },
  { label: '아니오', value: 'no' },
  { label: '사용하지 않음', value: 'manual' }
]
const androidInstallOptions = [
  { label: 'Android 앱으로 설치', value: 'app', icon: 'i-tabler-device-mobile' },
  { label: 'PC 프로그램으로 설치', value: 'pc', icon: 'i-tabler-device-desktop' }
]

const {
  data: releaseFeed,
  status: releaseStatus,
  error: releaseError
} = await useFetch<ReleaseFeedResponse>('/api/releases')

const {
  data: gameServer,
  status: gameServerStatus,
  error: gameServerError
} = useFetch<GameServerResponse>('/api/astral-server')

const defaultRecentChangesData: EditorTranslationLogResponse = {
  entries: [],
  total: 0,
  page: 1,
  pageSize: 50,
  totalPages: 1
}

const {
  data: recentChangesData,
  status: recentChangesStatus,
  error: recentChangesError
} = useFetch<EditorTranslationLogResponse>('/api/editor/log/translations', {
  query: { page: 1 },
  default: () => defaultRecentChangesData,
  server: false,
  lazy: true
})

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

const {
  data: overviewData,
  status: overviewStatus,
  error: overviewError
} = useFetch<EditorOverviewResponse>('/api/editor/overview', {
  server: false,
  lazy: true,
  default: createDefaultOverview
})

const overview = computed(() => overviewData.value ?? createDefaultOverview())
const isOverviewLoading = computed(() => overviewStatus.value === 'idle' || overviewStatus.value === 'pending')

const answers = reactive<Record<GuideAnswerKey, string | null>>({
  route: null,
  resources: null,
  gameRemoved: null,
  installMethod: null,
  usbDebugging: null,
  patcher: null,
  started: null,
  shizuku: null
})
const isDeveloperModeHelpOpen = ref(false)
const developerModeHelpContext = ref<'pc' | 'shizuku'>('shizuku')
const isGameNoticeOpen = ref(false)
const selectedGameNotice = ref<GameNotice | null>(null)

const selectedRoute = computed<SupportedRoute | null>(() => {
  const route = answers.route
  return route === 'INT_STEAM' || route === 'CN_STEAM' || route === 'INT_ANDROID' ? route : null
})
const isSteam = computed(() => selectedRoute.value === 'INT_STEAM' || selectedRoute.value === 'CN_STEAM')
const isAndroid = computed(() => selectedRoute.value === 'INT_ANDROID')

const recentReleases = computed<RecentReleaseEntry[]>(() => {
  const releases = releaseFeed.value?.releases
  if (!releases) {
    return []
  }

  return (Object.keys(releaseFeedLabels) as ReleaseFeedKey[])
    .flatMap(feed => releases[feed].map(release => ({ feed, release })))
    .sort((left, right) => {
      const leftTime = new Date(left.release.publishedAt).getTime()
      const rightTime = new Date(right.release.publishedAt).getTime()
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
    })
    .slice(0, RECENT_ITEM_LIMIT)
})

const recentChanges = computed<EditorTranslationLogEntry[]>(() =>
  (recentChangesData.value?.entries ?? []).slice(0, RECENT_ITEM_LIMIT)
)

function getLocalizedGameRawText(text?: GameLocalizedText): string {
  return text?.en || text?.jp || text?.cn || text?.tw || ''
}

function cleanGameText(value?: string): string {
  return (value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\[(?:\/?b|\/?color[^\]]*|\/?size[^\]]*|\/?url[^\]]*)\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getLocalizedGameText(text?: GameLocalizedText): string {
  return cleanGameText(getLocalizedGameRawText(text))
}

function escapeGameNoticeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#039;')
}

function getSafeGameNoticeUrl(value: string): string | null {
  const url = value.trim()
  return /^https?:\/\//i.test(url) ? url : null
}

function formatGameNoticeHtml(value?: string): string {
  const source = value ?? ''
  const tokenPattern = /<[^>]*>|\[[^\]]+\]/g
  let result = ''
  let lastIndex = 0

  for (const match of source.matchAll(tokenPattern)) {
    const index = match.index ?? 0
    result += escapeGameNoticeHtml(source.slice(lastIndex, index)).replace(/\r?\n/g, '<br>')

    const token = match[0]
    const normalizedToken = token.toLowerCase().replace(/\s+/g, '')
    const colorMatch = token.match(/^\[color=(#[0-9a-f]{3}|#[0-9a-f]{6})\]$/i)
    const sizeMatch = token.match(/^\[size=(\d{1,3})\]$/i)
    const urlMatch = token.match(/^\[url=(.+)\]$/i)
    const color = colorMatch?.[1]
    const rawSize = sizeMatch?.[1]
    const rawUrl = urlMatch?.[1]

    if (normalizedToken === '<b>' || normalizedToken === '<strong>' || normalizedToken === '[b]') {
      result += '<strong class="font-semibold">'
    } else if (normalizedToken === '</b>' || normalizedToken === '</strong>' || normalizedToken === '[/b]') {
      result += '</strong>'
    } else if (normalizedToken === '<i>' || normalizedToken === '<em>') {
      result += '<em>'
    } else if (normalizedToken === '</i>' || normalizedToken === '</em>') {
      result += '</em>'
    } else if (normalizedToken === '<u>') {
      result += '<u>'
    } else if (normalizedToken === '</u>') {
      result += '</u>'
    } else if (/^<br\/?\s*>$/i.test(token)) {
      result += '<br>'
    } else if (color) {
      result += `<span style="color: ${color}">`
    } else if (/^\[\/color\]$/i.test(token)) {
      result += '</span>'
    } else if (rawSize) {
      const size = Math.min(Math.max(Number(rawSize), 10), 40)
      result += `<span style="font-size: ${size}px">`
    } else if (/^\[\/size\]$/i.test(token)) {
      result += '</span>'
    } else if (rawUrl) {
      const safeUrl = getSafeGameNoticeUrl(rawUrl)
      if (safeUrl) {
        result += `<a href="${escapeGameNoticeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="text-info underline-offset-2 hover:underline">`
      }
    } else if (/^\[\/url\]$/i.test(token)) {
      result += '</a>'
    }

    lastIndex = index + token.length
  }

  result += escapeGameNoticeHtml(source.slice(lastIndex)).replace(/\r?\n/g, '<br>')
  return result
}

function openGameNotice(notice: GameNotice): void {
  selectedGameNotice.value = notice
  isGameNoticeOpen.value = true
}

function handleGameNoticeOpenChange(open: boolean): void {
  isGameNoticeOpen.value = open
  if (!open) {
    selectedGameNotice.value = null
  }
}

function getGameNoticeBannerUrl(banner: string): string {
  return `http://seresjp.feimogames.com/notice/banner/en/${banner}`
}

const gameNotices = computed<GameNotice[]>(() => (gameServer.value?.payload?.notices ?? [])
  .filter(notice => Boolean(getLocalizedGameText(notice.title)))
  .slice(-RECENT_ITEM_LIMIT)
  .reverse())

const gameServerLabel = computed(() => {
  if (gameServerStatus.value === 'pending' || gameServerStatus.value === 'idle') {
    return '게임 서버 상태 확인 중'
  }

  if (gameServerError.value) {
    return '게임 서버 상태 확인 실패'
  }

  if (gameServer.value?.payload?.server?.state === 1) {
    return '게임 접속 가능'
  }

  return getLocalizedGameText(gameServer.value?.payload?.server?.hint) || '게임 접속 불가'
})

const gameServerIndicatorClass = computed(() => {
  if (gameServerStatus.value === 'pending' || gameServerStatus.value === 'idle') {
    return 'bg-muted'
  }

  return gameServer.value?.payload?.server?.state === 1 && !gameServerError.value
    ? 'bg-success'
    : 'bg-error'
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
const steamManualPatch = computed(() => {
  if (!isSteam.value || !selectedRoute.value) {
    return null
  }

  return findAssetInRelease(latestPatchRelease.value, `${selectedRoute.value}_manual_patch.zip`)
})

function resetAnswers(...keys: GuideAnswerKey[]): void {
  for (const key of keys) {
    answers[key] = null
  }
}

watch(() => answers.route, () => {
  resetAnswers('resources', 'gameRemoved', 'installMethod', 'usbDebugging', 'patcher', 'started', 'shizuku')
})
watch(() => answers.resources, () => {
  resetAnswers('patcher', 'started')
})
watch(() => answers.gameRemoved, () => {
  resetAnswers('installMethod', 'usbDebugging', 'patcher', 'started', 'shizuku')
})
watch(() => answers.installMethod, () => {
  resetAnswers('usbDebugging', 'patcher', 'started', 'shizuku')
})
watch(() => answers.usbDebugging, () => {
  resetAnswers('patcher', 'started')
})
watch(() => answers.patcher, () => {
  resetAnswers('started', 'shizuku')
})

function openDeveloperModeHelp(context: 'pc' | 'shizuku'): void {
  developerModeHelpContext.value = context
  isDeveloperModeHelpOpen.value = true
}

function launchWindowsPatcher(action: 'install' | 'remove' | 'settings', route?: SupportedRoute): void {
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

function launchSelectedSteam(action: 'install' | 'remove'): void {
  if (selectedRoute.value === 'INT_STEAM' || selectedRoute.value === 'CN_STEAM') {
    launchWindowsPatcher(action, selectedRoute.value)
  }
}
</script>

<template>
  <div class="flex flex-col">
    <div class="relative -mx-3 -mt-5 overflow-hidden md:-mx-5">
      <video
        v-once
        width="1920"
        height="810"
        autoplay
        muted
        loop
        playsinline
        preload="metadata"
        aria-hidden="true"
        class="block h-auto w-full md:h-100 md:object-cover"
      >
        <source
          src="https://file.maynutlab.com/pv.mp4"
          type="video/mp4"
        >
      </video>

      <div
        aria-hidden="true"
        class="absolute inset-0 flex items-center justify-center bg-linear-to-t from-default to-default/40"
      >
        <div class="flex flex-col items-center">
          <div class="size-28 md:size-48 bg-[url(/ko_logo.png)] bg-contain bg-center bg-no-repeat" />
          <nav class="flex gap-1">
            <UTooltip
              text="Steam 상점"
              :delay-duration="0"
            >
              <UButton
                to="https://store.steampowered.com/app/2622000/Astral_Party/"
                icon="i-tabler-brand-steam-filled"
                color="neutral"
                variant="link"
                size="lg"
                :ui="{ base: 'p-2 md:p-2.5', leadingIcon: 'size-5 md:size-6' }"
              />
            </UTooltip>
            <UTooltip
              text="Discord"
              :delay-duration="0"
            >
              <UButton
                to="https://discord.com/invite/9n2dTTqk5C"
                icon="i-tabler-brand-discord-filled"
                color="neutral"
                variant="link"
                size="lg"
                :ui="{ base: 'p-2 md:p-2.5', leadingIcon: 'size-5 md:size-6' }"
              />
            </UTooltip>
            <UTooltip
              text="YouTube"
              :delay-duration="0"
            >
              <UButton
                to="https://www.youtube.com/@AstralParty_official"
                icon="i-tabler-brand-youtube-filled"
                color="neutral"
                variant="link"
                size="lg"
                :ui="{ base: 'p-2 md:p-2.5', leadingIcon: 'size-5 md:size-6' }"
              />
            </UTooltip>
            <UTooltip
              text="X"
              :delay-duration="0"
            >
              <UButton
                to="https://x.com/AstralParty_"
                icon="i-tabler-brand-x"
                color="neutral"
                variant="link"
                size="lg"
                :ui="{ base: 'p-2 md:p-2.5', leadingIcon: 'size-5 md:size-6' }"
              />
            </UTooltip>
          </nav>
        </div>
      </div>

      <div class="absolute left-1 top-1 md:left-3 md:top-3 z-1 flex max-w-[calc(100%-1.5rem)] items-center gap-2 bg-default/40 px-3 py-1.5 text-xs text-default backdrop-blur-lg">
        <span
          class="size-2 shrink-0"
          :class="gameServerIndicatorClass"
        />
        <span class="truncate -mt-px">
          {{ gameServerLabel }}
        </span>
      </div>
    </div>

    <section class="mx-auto flex w-full max-w-3xl flex-col gap-5 py-5">
      <h1 class="text-xl font-semibold">
        한글패치 설치 도우미
      </h1>

      <div class="flex flex-col">
        <HomeGuideStep
          v-model="answers.route"
          :step="1"
          title="어떤 플랫폼의 한글패치가 필요하나요?"
          description="한글패치를 설치할 플랫폼을 선택해 주세요."
          :options="routeOptions"
        />

        <template v-if="isSteam">
          <HomeGuideStep
            v-model="answers.resources"
            :step="2"
            title="인게임 리소스 다운로드를 완료했나요?"
            description="한글패치를 적용하기 전에 게임 안에서 필요한 리소스 다운로드가 완료되어 있어야 합니다."
            :options="yesNoOptions"
            :status="answers.resources === 'no' ? 'warning' : 'info'"
          >
            <UAlert
              v-if="answers.resources === 'no'"
              color="neutral"
              variant="soft"
              class="bg-muted"
              title="먼저 인게임 리소스 다운로드를 완료해 주세요."
              description="게임을 실행해 필요한 리소스를 모두 받은 뒤 '예'를 선택하세요."
            />
          </HomeGuideStep>

          <HomeGuideStep
            v-if="answers.resources === 'yes'"
            v-model="answers.patcher"
            :step="3"
            title="Windows 패치 프로그램을 설치했나요?"
            description="프로그램을 사용하지 않는 경우 수동 패치 파일을 받을 수 있습니다."
            :options="patcherOptions"
            :status="answers.patcher === 'no' ? 'warning' : answers.patcher === 'manual' ? 'success' : 'info'"
          >
            <div
              v-if="answers.patcher === 'no'"
              class="flex flex-col gap-3 bg-muted p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p class="text-sm font-medium text-default">
                  Windows 패치 프로그램 설치가 필요합니다.
                </p>
                <p class="mt-1 text-sm text-muted">
                  프로그램을 다운로드하고 한 번 실행한 뒤 '예'를 선택하세요.
                </p>
              </div>
              <UButton
                :href="windowsPatcher?.index.downloadUrl"
                :disabled="!windowsPatcher"
                external
                icon="i-tabler-download"
                color="info"
                variant="soft"
                size="lg"
                class="shrink-0 justify-center px-4 py-2.5"
              >
                Windows 패치 프로그램 다운로드
              </UButton>
            </div>

            <div
              v-if="answers.patcher === 'manual'"
              class="flex flex-col gap-3 bg-muted p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p class="text-sm font-medium text-default">
                  수동 설치 파일을 사용합니다.
                </p>
                <p class="mt-1 text-sm text-muted">
                  압축 파일 내의 설치 안내에 따라 직접 파일을 복사해 주세요.
                </p>
              </div>
              <UButton
                :href="steamManualPatch?.asset.downloadUrl"
                :disabled="!steamManualPatch"
                external
                icon="i-tabler-file-zip"
                color="info"
                variant="soft"
                size="lg"
                class="shrink-0 justify-center px-4 py-2.5"
              >
                수동 패치 파일 다운로드
              </UButton>
            </div>
          </HomeGuideStep>

          <HomeGuideStep
            v-if="answers.resources === 'yes' && answers.patcher === 'yes'"
            v-model="answers.started"
            :step="4"
            title="Windows 패치 프로그램을 한 번 실행했나요?"
            description="다운로드 후 최소 한번은 실행해야 사이트를 통해 프로그램을 실행시킬 수 있습니다."
            :options="yesNoOptions"
            :status="answers.started === 'no' ? 'warning' : 'info'"
          >
            <UAlert
              v-if="answers.started === 'no'"
              color="neutral"
              variant="soft"
              class="bg-muted"
              title="Windows 패치 프로그램을 먼저 한 번 실행해 주세요."
              description="프로그램 창이 정상적으로 열리는 것을 확인한 뒤 '예'를 선택하세요."
            />
          </HomeGuideStep>

          <HomeGuideStep
            v-if="answers.resources === 'yes' && answers.patcher === 'yes' && answers.started === 'yes'"
            :step="5"
            title="준비가 완료되었습니다."
            description="원하는 작업을 선택하면 Windows 패치 프로그램이 바로 실행됩니다."
            complete
          >
            <div class="flex flex-wrap gap-2">
              <UButton
                icon="i-tabler-wand"
                color="info"
                variant="soft"
                size="lg"
                class="px-4 py-2.5"
                @click="launchSelectedSteam('install')"
              >
                원클릭 한글패치 설치
              </UButton>
              <UButton
                icon="i-tabler-trash"
                color="error"
                variant="soft"
                size="lg"
                class="px-4 py-2.5"
                @click="launchSelectedSteam('remove')"
              >
                원클릭 한글패치 삭제
              </UButton>
            </div>
          </HomeGuideStep>
        </template>

        <template v-if="isAndroid">
          <HomeGuideStep
            v-model="answers.gameRemoved"
            :step="2"
            title="기존 게임 APK를 삭제했나요?"
            description="기존 APK가 설치된 상태에서는 한글패치용 APK를 설치할 수 없습니다."
            :options="yesNoOptions"
            :status="answers.gameRemoved === 'no' ? 'warning' : 'info'"
          >
            <UAlert
              v-if="answers.gameRemoved === 'no'"
              color="neutral"
              variant="soft"
              class="bg-muted"
              title="기존 게임 APK를 먼저 삭제해 주세요."
              description="기존 APK가 설치된 상태에서는 한글패치용 APK를 설치할 수 없습니다. 삭제한 뒤 '예'를 선택하세요."
            />
          </HomeGuideStep>

          <HomeGuideStep
            v-if="answers.gameRemoved === 'yes'"
            v-model="answers.installMethod"
            :step="3"
            title="어떤 방법으로 게임 APK를 설치할까요?"
            description="기기에서 패치 앱을 통해 설치하거나 PC의 패치 프로그램을 사용할 수 있습니다."
            :options="androidInstallOptions"
          />

          <template v-if="answers.gameRemoved === 'yes' && answers.installMethod === 'app'">
            <HomeGuideStep
              v-model="answers.patcher"
              :step="4"
              title="Android 패치 앱을 설치했나요?"
              description="한글패치용 게임 APK는 Android 패치 앱과 Shizuku를 통해 설치합니다."
              :options="yesNoOptions"
              :status="answers.patcher === 'no' ? 'warning' : 'info'"
            >
              <div
                v-if="answers.patcher === 'no'"
                class="flex flex-col gap-3 bg-muted p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p class="text-sm font-medium text-default">
                    Android 패치 앱 설치가 필요합니다.
                  </p>
                  <p class="mt-1 text-sm text-muted">
                    Android 패치 앱을 다운로드해 설치한 뒤 '예'를 선택하세요.
                  </p>
                </div>
                <UButton
                  :href="androidPatcher?.index.downloadUrl"
                  :disabled="!androidPatcher"
                  external
                  icon="i-tabler-download"
                  color="info"
                  variant="soft"
                  size="lg"
                  class="shrink-0 justify-center px-4 py-2.5"
                >
                  Android 패치 앱 다운로드
                </UButton>
              </div>
            </HomeGuideStep>

            <HomeGuideStep
              v-if="answers.patcher === 'yes'"
              v-model="answers.shizuku"
              :step="5"
              title="Shizuku를 실행하고 Android 패치 앱 권한을 허용했나요?"
              description="Android 패치 앱이 게임 APK를 올바른 설치 출처로 설치하려면 Shizuku 권한이 필요합니다."
              :options="yesNoOptions"
              :status="answers.shizuku === 'no' ? 'warning' : 'info'"
            >
              <template #before-options>
                <UButton
                  icon="i-tabler-settings-code"
                  color="neutral"
                  variant="soft"
                  size="lg"
                  class="w-fit px-4 py-2.5"
                  @click="openDeveloperModeHelp('shizuku')"
                >
                  개발자 모드 활성화 방법
                </UButton>
              </template>

              <UAlert
                v-if="answers.shizuku === 'no'"
                color="neutral"
                variant="soft"
                class="bg-muted"
                title="Shizuku 설정을 완료해 주세요."
                :description="`1. [Shizuku 다운로드 및 설치] 버튼을 탭해 Shizuku를 설치하세요.\n2. [Shizuku 열기] 버튼을 탭해 Shizuku를 실행하세요.\n3. [페어링] 버튼을 탭하고, [알림 옵션] 버튼을 탭해 알림을 허용해 주세요.\n4. '개발자 옵션'으로 이동한 다음 'USB 디버깅'과 '무선 디버깅'을 활성화해 주세요.\n5. '무선 디버깅'의 왼쪽을 탭한 다음 '페어링 코드로 기기 페어링'을 탭하세요.\n6. 알림창의 '페어링 코드 입력'을 탭해 기기 페어링 코드를 입력하세요.\n7. Shizuku로 돌아가 [시작] 버튼을 탭하세요.\n8. 완료된 경우 한글패치 앱으로 돌아가 [Shizuku 권한 허용] 버튼을 탭해 접근을 허용해 주세요.`"
                :ui="{ description: 'whitespace-pre-line' }"
              />
            </HomeGuideStep>

            <HomeGuideStep
              v-if="answers.patcher === 'yes' && answers.shizuku === 'yes'"
              :step="6"
              title="APK 설치 준비가 완료되었습니다."
              description="Android 패치 앱에서 최신 게임 APK 설치를 진행합니다."
              complete
            >
              <UButton
                icon="i-tabler-device-mobile-down"
                color="info"
                variant="soft"
                size="lg"
                class="w-fit px-4 py-2.5"
                @click="launchAndroidPatcher"
              >
                원클릭 게임 APK 설치
              </UButton>
            </HomeGuideStep>
          </template>

          <template v-if="answers.gameRemoved === 'yes' && answers.installMethod === 'pc'">
            <HomeGuideStep
              v-model="answers.usbDebugging"
              :step="4"
              title="개발자 옵션과 USB 디버깅을 활성화했나요?"
              description="PC에서 Android 기기에 게임 APK를 설치하려면 USB 디버깅이 활성화되어 있어야 합니다."
              :options="yesNoOptions"
              :status="answers.usbDebugging === 'no' ? 'warning' : 'info'"
            >
              <template #before-options>
                <UButton
                  icon="i-tabler-settings-code"
                  color="neutral"
                  variant="soft"
                  size="lg"
                  class="w-fit px-4 py-2.5"
                  @click="openDeveloperModeHelp('pc')"
                >
                  USB 디버깅 활성화 방법
                </UButton>
              </template>

              <UAlert
                v-if="answers.usbDebugging === 'no'"
                color="neutral"
                variant="soft"
                class="bg-muted"
                title="개발자 옵션과 USB 디버깅을 먼저 활성화해 주세요."
                description="설정을 완료한 뒤 USB 케이블로 기기를 PC에 연결하고, 기기에 USB 디버깅 허용 창이 표시되면 허용한 다음 '예'를 선택하세요."
              />
            </HomeGuideStep>

            <HomeGuideStep
              v-if="answers.usbDebugging === 'yes'"
              v-model="answers.patcher"
              :step="5"
              title="Windows 패치 프로그램을 설치했나요?"
              description="PC에서 게임 APK를 설치하려면 Windows 패치 프로그램이 필요합니다."
              :options="yesNoOptions"
              :status="answers.patcher === 'no' ? 'warning' : 'info'"
            >
              <div
                v-if="answers.patcher === 'no'"
                class="flex flex-col gap-3 bg-muted p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p class="text-sm font-medium text-default">
                    Windows 패치 프로그램 설치가 필요합니다.
                  </p>
                  <p class="mt-1 text-sm text-muted">
                    Windows 패치 프로그램을 다운로드해 설치한 뒤 '예'를 선택하세요.
                  </p>
                </div>
                <UButton
                  :href="windowsPatcher?.index.downloadUrl"
                  :disabled="!windowsPatcher"
                  external
                  icon="i-tabler-download"
                  color="info"
                  variant="soft"
                  size="lg"
                  class="shrink-0 justify-center px-4 py-2.5"
                >
                  Windows 패치 프로그램 다운로드
                </UButton>
              </div>
            </HomeGuideStep>

            <HomeGuideStep
              v-if="answers.usbDebugging === 'yes' && answers.patcher === 'yes'"
              v-model="answers.started"
              :step="6"
              title="Windows 패치 프로그램을 한 번 실행했나요?"
              description="다운로드 후 최소 한번은 실행해야 사이트를 통해 프로그램을 실행시킬 수 있습니다."
              :options="yesNoOptions"
              :status="answers.started === 'no' ? 'warning' : 'info'"
            >
              <UAlert
                v-if="answers.started === 'no'"
                color="neutral"
                variant="soft"
                class="bg-muted"
                title="Windows 패치 프로그램을 먼저 한 번 실행해 주세요."
                description="프로그램 창이 정상적으로 열리는 것을 확인한 뒤 '예'를 선택하세요."
              />
            </HomeGuideStep>

            <HomeGuideStep
              v-if="answers.usbDebugging === 'yes' && answers.patcher === 'yes' && answers.started === 'yes'"
              :step="7"
              title="APK 설치 준비가 완료되었습니다."
              description="Windows 패치 프로그램에서 최신 Android 일본 버전 게임 APK 설치를 진행합니다."
              complete
            >
              <UButton
                icon="i-tabler-device-mobile-down"
                color="info"
                variant="soft"
                size="lg"
                class="px-4 py-2.5 w-fit"
                @click="launchWindowsPatcher('install', 'INT_ANDROID')"
              >
                원클릭 게임 APK 설치
              </UButton>
            </HomeGuideStep>
          </template>
        </template>
      </div>
    </section>

    <section class="mx-auto grid w-full max-w-400 gap-3 py-5 lg:grid-cols-2">
      <div class="flex min-w-0 flex-col gap-3">
        <div class="flex min-w-0 flex-col border border-default">
          <header class="flex items-center justify-between gap-3 border-b border-default bg-muted p-2 pl-4">
            <div class="flex min-w-0 items-center gap-2">
              <UIcon
                name="i-tabler-clipboard-check"
                class="size-5 shrink-0"
              />
              <h2 class="truncate text-base font-medium text-default">
                릴리즈 노트
              </h2>
            </div>

            <UButton
              to="/release"
              trailing-icon="i-tabler-arrow-right"
              color="neutral"
              variant="link"
              size="md"
              class="shrink-0"
            >
              전체 보기
            </UButton>
          </header>

          <div
            v-if="releaseStatus === 'pending'"
            class="flex flex-col"
          >
            <div
              v-for="index in RECENT_ITEM_LIMIT"
              :key="index"
              class="flex flex-col gap-2 border-b border-default p-4 last:border-b-0"
            >
              <USkeleton class="h-4 w-2/3" />
              <USkeleton class="h-3 w-1/3" />
            </div>
          </div>

          <div
            v-else-if="releaseError"
            class="flex min-h-40 items-center justify-center p-5 text-sm text-muted"
          >
            릴리즈 정보를 불러오지 못했습니다.
          </div>

          <div
            v-else-if="!recentReleases.length"
            class="flex min-h-40 items-center justify-center p-5 text-sm text-muted"
          >
            표시할 릴리즈 기록이 없습니다.
          </div>

          <div
            v-else
            class="flex flex-col"
          >
            <a
              v-for="item in recentReleases"
              :key="`${item.feed}-${item.release.id}-${item.release.tagName}`"
              :href="item.release.url"
              target="_blank"
              rel="noopener noreferrer"
              class="flex min-w-0 flex-col gap-2 border-b border-default p-4 transition-colors last:border-b-0 hover:bg-muted"
            >
              <div class="flex min-w-0 items-center gap-2">
                <UBadge
                  color="neutral"
                  variant="soft"
                  size="sm"
                  class="shrink-0"
                >
                  {{ releaseFeedLabels[item.feed] }}
                </UBadge>
                <span class="truncate text-sm font-medium text-default">
                  {{ item.release.title }}
                </span>
              </div>

              <div class="flex min-w-0 items-center gap-1 text-xs text-muted">
                <span class="truncate">{{ item.release.tagName }}</span>
                <span aria-hidden="true">·</span>
                <time
                  class="shrink-0"
                  :datetime="item.release.publishedAt"
                >
                  {{ formatEditorDate(item.release.publishedAt) }}
                </time>
              </div>
            </a>
          </div>
        </div>

        <div class="flex min-w-0 flex-col border border-default">
          <header class="flex items-center gap-2 border-b border-default bg-muted px-4 py-3">
            <UIcon
              name="i-tabler-speakerphone"
              class="size-5 shrink-0"
            />
            <h2 class="truncate text-base font-medium text-default">
              게임 공지
            </h2>
          </header>

          <div
            v-if="gameServerStatus === 'pending' || gameServerStatus === 'idle'"
            class="flex flex-col"
          >
            <div
              v-for="index in RECENT_ITEM_LIMIT"
              :key="index"
              class="border-b border-default p-4 last:border-b-0"
            >
              <USkeleton class="h-4 w-2/3" />
            </div>
          </div>

          <div
            v-else-if="gameServerError"
            class="flex min-h-28 items-center justify-center p-5 text-sm text-muted"
          >
            게임 공지를 불러오지 못했습니다.
          </div>

          <div
            v-else-if="!gameNotices.length"
            class="flex min-h-28 items-center justify-center p-5 text-sm text-muted"
          >
            표시할 게임 공지가 없습니다.
          </div>

          <div
            v-else
            class="flex flex-col"
          >
            <button
              v-for="notice in gameNotices"
              :key="notice.id"
              type="button"
              class="group flex w-full items-center gap-3 border-b border-default p-4 text-left transition-colors last:border-b-0 hover:bg-muted"
              @click="openGameNotice(notice)"
            >
              <p class="min-w-0 flex-1 line-clamp-2 whitespace-pre-wrap wrap-break-word text-sm leading-5 text-default">
                {{ getLocalizedGameText(notice.title) || '공지사항' }}
              </p>
              <UIcon
                name="i-tabler-chevron-right"
                class="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
              />
            </button>
          </div>
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-3">
        <div class="flex min-w-0 flex-col border border-default">
          <header class="flex items-center justify-between gap-3 border-b border-default bg-muted p-2 pl-4">
            <div class="flex min-w-0 items-center gap-2">
              <UIcon
                name="i-tabler-language"
                class="size-5 shrink-0"
              />
              <h2 class="truncate text-base font-medium text-default">
                번역 대시보드
              </h2>
            </div>

            <UButton
              to="/translate"
              trailing-icon="i-tabler-arrow-right"
              color="neutral"
              variant="link"
              size="md"
              class="shrink-0"
            >
              전체 보기
            </UButton>
          </header>

          <ClientOnly>
            <div
              v-if="isOverviewLoading"
              class="flex flex-col gap-4 p-4"
            >
              <div class="flex items-end justify-between gap-4">
                <div class="flex flex-col gap-2">
                  <USkeleton class="h-4 w-20" />
                  <USkeleton class="h-8 w-24" />
                </div>
                <USkeleton class="h-4 w-28" />
              </div>
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <USkeleton
                  v-for="status in EDITOR_VISIBLE_STATUSES"
                  :key="status"
                  class="h-14 w-full"
                />
              </div>
            </div>

            <div
              v-else-if="overviewError"
              class="flex min-h-28 items-center justify-center p-5 text-sm text-muted"
            >
              번역 상태를 불러오지 못했습니다.
            </div>

            <div
              v-else
              class="flex flex-col gap-4 p-4"
            >
              <div class="flex items-end justify-between gap-4">
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="text-xs text-muted">번역 진행도</span>
                  <span class="text-2xl font-medium text-default">
                    {{ formatEditorPercent(overview.overall.success, overview.overall.total) }}
                  </span>
                </div>
                <span class="shrink-0 text-xs text-muted">
                  {{ formatEditorCount(overview.overall.success) }} / {{ formatEditorCount(overview.overall.total) }}개
                </span>
              </div>

              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div
                  v-for="status in EDITOR_VISIBLE_STATUSES"
                  :key="status"
                  class="flex min-w-0 flex-col gap-1 bg-muted px-3 py-2.5"
                >
                  <span
                    class="truncate text-xs"
                    :class="EDITOR_STATUS_META[status].textColor"
                  >
                    {{ EDITOR_STATUS_META[status].label }}
                  </span>
                  <span class="text-sm font-medium text-default">
                    {{ formatEditorCount(overview.overall[status]) }}개
                  </span>
                </div>
              </div>
            </div>

            <template #fallback>
              <div class="flex flex-col gap-4 p-4">
                <div class="flex items-end justify-between gap-4">
                  <div class="flex flex-col gap-2">
                    <USkeleton class="h-4 w-20" />
                    <USkeleton class="h-8 w-24" />
                  </div>
                  <USkeleton class="h-4 w-28" />
                </div>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <USkeleton
                    v-for="status in EDITOR_VISIBLE_STATUSES"
                    :key="status"
                    class="h-14 w-full"
                  />
                </div>
              </div>
            </template>
          </ClientOnly>
        </div>

        <div class="flex min-w-0 flex-col border border-default">
          <header class="flex items-center justify-between gap-3 border-b border-default bg-muted p-2 pl-4">
            <div class="flex min-w-0 items-center gap-2">
              <UIcon
                name="i-tabler-history-toggle"
                class="size-5 shrink-0"
              />
              <h2 class="truncate text-base font-medium text-default">
                변경 기록
              </h2>
            </div>

            <UButton
              to="/change"
              trailing-icon="i-tabler-arrow-right"
              color="neutral"
              variant="link"
              size="md"
              class="shrink-0"
            >
              전체 보기
            </UButton>
          </header>

          <ClientOnly>
            <div
              v-if="recentChangesStatus === 'pending' || recentChangesStatus === 'idle'"
              class="flex flex-col"
            >
              <div
                v-for="index in RECENT_ITEM_LIMIT"
                :key="index"
                class="flex flex-col gap-2 border-b border-default p-4 last:border-b-0"
              >
                <USkeleton class="h-4 w-1/2" />
                <USkeleton class="h-4 w-full" />
                <USkeleton class="h-3 w-1/3" />
              </div>
            </div>

            <div
              v-else-if="recentChangesError"
              class="flex min-h-40 items-center justify-center p-5 text-sm text-muted"
            >
              변경 기록을 불러오지 못했습니다.
            </div>

            <div
              v-else-if="!recentChanges.length"
              class="flex min-h-40 items-center justify-center p-5 text-sm text-muted"
            >
              표시할 변경 기록이 없습니다.
            </div>

            <div
              v-else
              class="flex flex-col"
            >
              <NuxtLink
                v-for="entry in recentChanges"
                :key="entry.id"
                :to="{
                  path: '/translate/editor',
                  query: {
                    file: entry.category,
                    search: `${entry.category}_${entry.unitKey}`,
                    searchType: 'key',
                    match: 'exact',
                    page: '1'
                  }
                }"
                class="flex min-w-0 flex-col gap-2 border-b border-default p-4 transition-colors last:border-b-0 hover:bg-muted"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <UBadge
                    :color="changeStatusColors[entry.status]"
                    variant="soft"
                    size="sm"
                    class="shrink-0"
                  >
                    {{ changeStatusLabels[entry.status] }}
                  </UBadge>
                  <span
                    class="min-w-0 flex-1 truncate text-sm font-medium text-default"
                    :title="`${entry.category}_${entry.unitKey}`"
                  >
                    {{ entry.category }}_{{ entry.unitKey }}
                  </span>
                </div>

                <p class="line-clamp-2 whitespace-pre-wrap wrap-break-word text-sm leading-5 text-toned">
                  <template
                    v-for="(part, partIndex) in getEditorDiffParts(entry.previousText ?? '', entry.proposedText)"
                    :key="`${part.type}-${partIndex}`"
                  >
                    <span
                      :class="part.type === 'removed'
                        ? 'bg-error/10 text-error'
                        : part.type === 'added'
                          ? 'bg-success/10 text-success'
                          : 'text-toned'"
                    >{{ part.text }}</span>
                  </template>
                  <span v-if="!entry.previousText && !entry.proposedText">빈 문자열</span>
                </p>

                <div class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  <AppUserIdentity
                    :handle="entry.handle"
                    :role="entry.actorRole"
                    fallback="익명"
                    :link="false"
                    text-class="text-xs"
                    icon-class="size-3.5"
                  />
                  <span aria-hidden="true">·</span>
                  <time
                    class="shrink-0"
                    :datetime="entry.createdAt"
                  >
                    {{ formatEditorDate(entry.createdAt) }}
                  </time>
                </div>
              </NuxtLink>
            </div>

            <template #fallback>
              <div class="flex flex-col">
                <div
                  v-for="index in RECENT_ITEM_LIMIT"
                  :key="index"
                  class="flex flex-col gap-2 border-b border-default p-4 last:border-b-0"
                >
                  <USkeleton class="h-4 w-1/2" />
                  <USkeleton class="h-4 w-full" />
                  <USkeleton class="h-3 w-1/3" />
                </div>
              </div>
            </template>
          </ClientOnly>
        </div>
      </div>
    </section>

    <UModal
      v-model:open="isDeveloperModeHelpOpen"
      :title="developerModeHelpContext === 'pc'
        ? 'USB 디버깅 활성화 방법'
        : '개발자 모드 활성화 방법'"
      :ui="{
        content: 'sm:max-w-160'
      }"
    >
      <template #body>
        <div
          class="space-y-5"
          :class="developerModeHelpContext === 'shizuku' ? '[&_ol>li:nth-child(n+4)]:hidden' : ''"
        >
          <ol class="flex flex-col gap-4">
            <li class="flex items-start gap-3">
              <span class="flex size-8 shrink-0 items-center justify-center bg-muted text-sm font-medium text-muted">
                1
              </span>
              <div class="min-w-0 pt-0.5">
                <p class="text-sm font-medium text-default">
                  휴대전화 정보 열기
                </p>
                <p class="mt-1 text-sm leading-5 text-muted">
                  설정 앱을 열고 <span class="text-default">휴대전화 정보/태블릿 정보</span>로 이동하세요.
                </p>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <span class="flex size-8 shrink-0 items-center justify-center bg-muted text-sm font-medium text-muted">
                2
              </span>
              <div class="min-w-0 pt-0.5">
                <p class="text-sm font-medium text-default">
                  빌드 번호 7번 연타하기
                </p>
                <p class="mt-1 text-sm leading-5 text-muted">
                  <span class="text-default">소프트웨어 정보</span>를 열고 <span class="text-default">빌드 번호</span>를 7번 연속으로 탭하세요.
                </p>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <span class="flex size-8 shrink-0 items-center justify-center bg-muted text-sm font-medium text-muted">
                3
              </span>
              <div class="min-w-0 pt-0.5">
                <p class="text-sm font-medium text-default">
                  개발자 모드 활성화
                </p>
                <p class="mt-1 text-sm leading-5 text-muted">
                  화면 잠금 PIN이나 비밀번호를 입력하면 개발자 모드가 활성화됩니다.
                </p>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <span class="flex size-8 shrink-0 items-center justify-center bg-muted text-sm font-medium text-muted">
                4
              </span>
              <div class="min-w-0 pt-0.5">
                <p class="text-sm font-medium text-default">
                  USB 디버깅 활성화
                </p>
                <p class="mt-1 text-sm leading-5 text-muted">
                  설정 화면으로 돌아가 <span class="text-default">개발자 옵션</span>을 연 다음 <span class="text-default">USB 디버깅</span>을 활성화하세요.
                </p>
              </div>
            </li>
            <li
              v-if="developerModeHelpContext === 'shizuku'"
              class="flex items-start gap-3"
            >
              <span class="flex size-8 shrink-0 items-center justify-center bg-muted text-sm font-medium text-muted">
                5
              </span>
              <div class="min-w-0 pt-0.5">
                <p class="text-sm font-medium text-default">
                  무선 디버깅 활성화
                </p>
                <p class="mt-1 text-sm leading-5 text-muted">
                  Shizuku를 사용하려면 같은 화면에서 <span class="text-default">무선 디버깅</span>도 활성화하세요.
                </p>
              </div>
            </li>
            <li
              v-else
              class="flex items-start gap-3"
            >
              <span class="flex size-8 shrink-0 items-center justify-center bg-muted text-sm font-medium text-muted">
                5
              </span>
              <div class="min-w-0 pt-0.5">
                <p class="text-sm font-medium text-default">
                  PC 연결 허용
                </p>
                <p class="mt-1 text-sm leading-5 text-muted">
                  USB 케이블로 기기를 PC에 연결하고, 기기에 표시되는 <span class="text-default">USB 디버깅 허용</span> 창에서 허용을 선택하세요.
                </p>
              </div>
            </li>
          </ol>

          <UAlert
            color="neutral"
            variant="soft"
            class="bg-muted"
            title="기기에 따라 메뉴 이름이나 위치가 다를 수 있습니다."
            description="개발자 옵션이 보이지 않으면 설정 검색에서 '빌드 번호' 또는 '개발자 옵션'을 검색해 보세요."
          />
        </div>
      </template>
    </UModal>

    <UModal
      :open="isGameNoticeOpen"
      :title="getLocalizedGameText(selectedGameNotice?.title) || '게임 공지'"
      :ui="{
        content: 'sm:max-w-240',
        body: 'p-0 sm:p-0'
      }"
      @update:open="handleGameNoticeOpenChange"
    >
      <!-- eslint-disable vue/no-v-html -- game notice markup is sanitized by formatGameNoticeHtml -->
      <template #title>
        <span
          class="wrap-break-word text-default"
          v-html="formatGameNoticeHtml(getLocalizedGameRawText(selectedGameNotice?.title))"
        />
      </template>

      <template #body>
        <div class="p-4 sm:p-6 overflow-y-auto">
          <div
            v-if="selectedGameNotice?.items?.length"
            class="flex flex-col gap-6"
          >
            <section
              v-for="(item, index) in selectedGameNotice.items"
              :key="`${selectedGameNotice.id}-${index}`"
              class="flex flex-col gap-4 border-b border-default pb-6 last:border-b-0 last:pb-0"
            >
              <img
                v-if="item.banner"
                :src="getGameNoticeBannerUrl(item.banner)"
                :alt="item.banner"
                class="h-auto w-full max-w-140 object-contain"
                loading="lazy"
              >

              <div
                v-if="getLocalizedGameRawText(item.content)"
                class="wrap-break-word text-sm leading-relaxed text-default [&_a]:break-all"
                v-html="formatGameNoticeHtml(getLocalizedGameRawText(item.content))"
              />
            </section>
          </div>

          <p
            v-else
            class="py-4 text-center text-sm text-muted"
          >
            표시할 상세 내용이 없습니다.
          </p>
        </div>
      </template>
      <!-- eslint-enable vue/no-v-html -->
    </UModal>
  </div>
</template>
