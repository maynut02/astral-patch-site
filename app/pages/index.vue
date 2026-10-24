<script setup lang="ts">
import type {
  EditorTranslationLogEntry,
  EditorTranslationLogResponse
} from '#shared/types/editor'
import type { EditorOverviewResponse } from '#shared/types/editor-overview'
import type {
  ReleaseFeedKey,
  ReleaseNoteEntry
} from '#shared/types/releases'
import type { GameLocalizedText, GameNotice, GameServerResponse } from '#shared/types/game-server'
import { getEditorDiffParts } from '~/utils/editor-diff'
import { formatEditorCount, formatEditorDate, formatEditorPercent } from '~/utils/editor-helpers'
import { createEmptyEditorOverview, EDITOR_CHANGE_STATUS_META, EDITOR_STATUS_META, EDITOR_VISIBLE_STATUSES } from '~/utils/editor-progress'
import { cleanGameText, formatGameNoticeHtml } from '~/utils/game-notice'
import { getEditorItemLocation } from '~/utils/editor-links'
import { findAssetInRelease } from '~/utils/release-assets'
import { useReleaseFeed, useReleaseDistribution } from '~/composables/use-release-feed'
import { useHomeInstallGuide } from '~/composables/home-install-guide'
import { RELEASE_FEED_LABELS as releaseFeedLabels } from '~/utils/patch-routes'
import { EXTERNAL_LINKS } from '~/utils/links'

interface RecentReleaseEntry {
  feed: ReleaseFeedKey
  release: ReleaseNoteEntry
}

const RECENT_ITEM_LIMIT = 5

const {
  answers, routeOptions, yesNoOptions, steamMethodOptions, patcherOptions,
  selectedRoute, isSteam, isAndroid, launchSelectedSteam
} = useHomeInstallGuide()
const {
  data: releaseFeed,
  status: releaseStatus,
  error: releaseError
} = await useReleaseFeed('home-release-feed')

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

const {
  data: overviewData,
  status: overviewStatus,
  error: overviewError
} = useFetch<EditorOverviewResponse>('/api/editor/overview', {
  server: false,
  lazy: true,
  default: createEmptyEditorOverview
})

const overview = computed(() => overviewData.value ?? createEmptyEditorOverview())
const isOverviewLoading = computed(() => overviewStatus.value === 'idle' || overviewStatus.value === 'pending')

const isDeveloperModeHelpOpen = ref(false)
const developerModeHelpContext = ref<'pc' | 'shizuku'>('shizuku')
const isGameNoticeOpen = ref(false)
const selectedGameNotice = ref<GameNotice | null>(null)

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

function getLocalizedGameText(text?: GameLocalizedText): string {
  return cleanGameText(getLocalizedGameRawText(text))
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
  return `${EXTERNAL_LINKS.gameNoticeBannerBase}${banner}`
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

const { windowsPatcher, windowsPlugin, androidPatcher, latestPatchRelease } = useReleaseDistribution(releaseFeed)
const steamManualPatch = computed(() => {
  if (!isSteam.value || !selectedRoute.value) {
    return null
  }

  return findAssetInRelease(latestPatchRelease.value, `${selectedRoute.value}_manual_patch.zip`)
})
const steamPluginTargetFolder = computed(() => selectedRoute.value === 'CN_STEAM' ? '8vJXn6CN' : '8vJXnINT')

function openDeveloperModeHelp(context: 'pc' | 'shizuku'): void {
  developerModeHelpContext.value = context
  isDeveloperModeHelpOpen.value = true
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
          :src="EXTERNAL_LINKS.promotionalVideo"
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
                :to="EXTERNAL_LINKS.steam"
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
                :to="EXTERNAL_LINKS.homeDiscordInvite"
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
                :to="EXTERNAL_LINKS.youtube"
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
                :to="EXTERNAL_LINKS.x"
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

      <div class="absolute left-1 top-1 md:left-3 md:top-3 z-1 flex max-w-[calc(100%-1.5rem)] items-center gap-2 bg-default/40 px-2 md:px-3 py-1 md:py-1.5 text-default font-medium backdrop-blur-lg">
        <span
          class="size-1.5 shrink-0"
          :class="gameServerIndicatorClass"
        />
        <span class="truncate -mt-px text-[10px] md:text-xs">
          {{ gameServerLabel }}
        </span>
      </div>
    </div>

    <HomeGuideWizard
      :answers="answers"
      :route-options="routeOptions"
      :yes-no-options="yesNoOptions"
      :steam-method-options="steamMethodOptions"
      :patcher-options="patcherOptions"
      :is-steam="isSteam"
      :is-android="isAndroid"
      :windows-patcher="windowsPatcher"
      :windows-plugin="windowsPlugin"
      :android-patcher="androidPatcher"
      :steam-manual-patch="steamManualPatch"
      :steam-plugin-target-folder="steamPluginTargetFolder"
      :launch-selected-steam="launchSelectedSteam"
      :open-developer-mode-help="openDeveloperModeHelp"
    />

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
                :to="getEditorItemLocation(entry)"
                class="flex min-w-0 flex-col gap-2 border-b border-default p-4 transition-colors last:border-b-0 hover:bg-muted"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <UBadge
                    :color="EDITOR_CHANGE_STATUS_META[entry.status].color"
                    variant="soft"
                    size="sm"
                    class="shrink-0"
                  >
                    {{ EDITOR_CHANGE_STATUS_META[entry.status].label }}
                  </UBadge>
                  <span
                    class="min-w-0 flex-1 truncate text-xs font-medium text-default"
                    :title="`${entry.category}_${entry.unitKey}`"
                  >
                    {{ entry.category }}_{{ entry.unitKey }}
                  </span>
                </div>

                <p class="line-clamp-2 whitespace-pre-wrap wrap-break-word text-sm leading-5 text-toned">
                  <EditorDiffText :parts="getEditorDiffParts(entry.previousText ?? '', entry.proposedText)" side="unified" />
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
