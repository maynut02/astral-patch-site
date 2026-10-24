<script setup lang="ts">
import type { ReleaseAssetMatch } from '~/utils/release-assets'
import { findAssetInRelease } from '~/utils/release-assets'
import { formatCount, formatDate, formatFetchedAgo as formatRelativeFetchedAgo, formatFileSize } from '~/utils/format'
import { launchWindowsPatcher } from '~/utils/patcher-launch'
import { useReleaseFeed, useReleaseDistribution } from '~/composables/use-release-feed'
import { useRelativeNow } from '~/composables/use-relative-now'
import { EXTERNAL_LINKS } from '~/utils/links'

useAstralPageSeo('다운로드')

const {
  data: releaseFeed,
  status,
  error,
  refresh
} = await useReleaseFeed('download-release-feed')

const relativeTimeNow = useRelativeNow()

const { windowsPatcher, windowsPlugin, androidPatcher, latestPatchRelease, latestPatchVersion } = useReleaseDistribution(releaseFeed)
const intSteamManual = computed(() => findAssetInRelease(latestPatchRelease.value, 'INT_STEAM_manual_patch.zip'))
const cnSteamManual = computed(() => findAssetInRelease(latestPatchRelease.value, 'CN_STEAM_manual_patch.zip'))
const intSteamManifest = computed(() => findAssetInRelease(latestPatchRelease.value, 'INT_STEAM_manifest.json'))
const cnSteamManifest = computed(() => findAssetInRelease(latestPatchRelease.value, 'CN_STEAM_manifest.json'))
const intAndroidManual = computed(() => findAssetInRelease(latestPatchRelease.value, 'INT_ANDROID_manual_patch.zip'))
const cnAndroidManual = computed(() => findAssetInRelease(latestPatchRelease.value, 'CN_ANDROID_manual_patch.zip'))
const intAndroidManifest = computed(() => findAssetInRelease(latestPatchRelease.value, 'INT_ANDROID_manifest.json'))
const cnAndroidManifest = computed(() => findAssetInRelease(latestPatchRelease.value, 'CN_ANDROID_manifest.json'))

function sumPatchDownloadCounts(
  manual: ReleaseAssetMatch | null,
  manifest: ReleaseAssetMatch | null
): number | null {
  if (!manual && !manifest) {
    return null
  }

  return (manual?.asset.downloadCount ?? 0)
    + (manifest?.asset.downloadCount ?? 0)
}

const intSteamDownloadCount = computed(() => sumPatchDownloadCounts(intSteamManual.value, intSteamManifest.value))
const cnSteamDownloadCount = computed(() => sumPatchDownloadCounts(cnSteamManual.value, cnSteamManifest.value))
const intAndroidDownloadCount = computed(() => sumPatchDownloadCounts(intAndroidManual.value, intAndroidManifest.value))
const cnAndroidDownloadCount = computed(() => sumPatchDownloadCounts(cnAndroidManual.value, cnAndroidManifest.value))

function formatFetchedAgo(value: string): string {
  return formatRelativeFetchedAgo(value, relativeTimeNow.value)
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
        <DownloadArtifactCard
          icon="i-tabler-plug"
          :file-name="windowsPlugin?.asset?.name ?? 'AstralPartyKoreanPlugin-v*.zip'"
          title="Windows 패치 플러그인"
          :version="windowsPlugin ? `v${windowsPlugin.index.version}` : '확인 중'"
          :release-date="windowsPlugin?.release ? formatDate(windowsPlugin.release.publishedAt) : '—'"
          :file-size="windowsPlugin ? formatFileSize(windowsPlugin.index.size) : '—'"
          :download-count="windowsPlugin?.asset ? formatCount(windowsPlugin.asset.downloadCount) : '—'"
        >
          <template #default>
            <UButton
              :href="windowsPlugin?.index.downloadUrl"
              :disabled="!windowsPlugin"
              external
              icon="i-tabler-download"
              color="info"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
            >
              Windows 패치 플러그인 다운로드
            </UButton>
          </template>
        </DownloadArtifactCard>

        <DownloadArtifactCard
          icon="i-tabler-app-window"
          file-name="AstralWindowsPatcher.exe"
          title="Windows 패치 프로그램"
          :version="windowsPatcher ? `v${windowsPatcher.index.version}` : '확인 중'"
          :release-date="windowsPatcher?.release ? formatDate(windowsPatcher.release.publishedAt) : '—'"
          :file-size="windowsPatcher ? formatFileSize(windowsPatcher.index.size) : '—'"
          :download-count="windowsPatcher?.asset ? formatCount(windowsPatcher.asset.downloadCount) : '—'"
        >
          <template #default>
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
          </template>
        </DownloadArtifactCard>

        <DownloadArtifactCard
          icon="i-tabler-device-mobile"
          file-name="AstralAndroidPatcher.apk"
          title="Android 패치 앱"
          :version="androidPatcher ? `v${androidPatcher.index.version}` : '확인 중'"
          :release-date="androidPatcher?.release ? formatDate(androidPatcher.release.publishedAt) : '—'"
          :file-size="androidPatcher ? formatFileSize(androidPatcher.index.size) : '—'"
          :download-count="androidPatcher?.asset ? formatCount(androidPatcher.asset.downloadCount) : '—'"
        >
          <template #default>
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
              :href="EXTERNAL_LINKS.android"
              external
              icon="i-tabler-external-link"
              color="neutral"
              variant="ghost"
              size="md"
              class="gap-2 py-2.5"
            >
              패치 앱 열기
            </UButton>
          </template>
        </DownloadArtifactCard>
      </div>
    </section>

    <section class="flex flex-col gap-3 mt-3">
      <span class="font-medium">
        패치 파일
      </span>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-3">
        <DownloadArtifactCard
          kind="patch"
          icon="i-tabler-brand-steam"
          file-name="INT_STEAM"
          title="Steam 글로벌 버전"
          :version="latestPatchVersion ?? '확인 중'"
          :release-date="latestPatchRelease ? formatDate(latestPatchRelease.publishedAt) : '—'"
          :file-size="intSteamManual ? formatFileSize(intSteamManual.asset.size) : '—'"
          :download-count="intSteamDownloadCount !== null ? formatCount(intSteamDownloadCount) : '—'"
        >
          <template #default>
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
          </template>
        </DownloadArtifactCard>

        <DownloadArtifactCard
          kind="patch"
          icon="i-tabler-brand-steam"
          file-name="CN_STEAM"
          title="Steam 중국 버전"
          :version="latestPatchVersion ?? '확인 중'"
          :release-date="latestPatchRelease ? formatDate(latestPatchRelease.publishedAt) : '—'"
          :file-size="cnSteamManual ? formatFileSize(cnSteamManual.asset.size) : '—'"
          :download-count="cnSteamDownloadCount !== null ? formatCount(cnSteamDownloadCount) : '—'"
        >
          <template #default>
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
          </template>
        </DownloadArtifactCard>

        <DownloadArtifactCard
          kind="patch"
          icon="i-tabler-brand-android"
          file-name="INT_ANDROID"
          title="Android 일본 버전"
          :version="latestPatchVersion ?? '확인 중'"
          :release-date="latestPatchRelease ? formatDate(latestPatchRelease.publishedAt) : '—'"
          :file-size="intAndroidManual ? formatFileSize(intAndroidManual.asset.size) : '—'"
          :download-count="intAndroidDownloadCount !== null ? formatCount(intAndroidDownloadCount) : '—'"
        >
          <template #default>
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
          </template>
        </DownloadArtifactCard>

        <DownloadArtifactCard
          kind="patch"
          icon="i-tabler-brand-android"
          file-name="CN_ANDROID"
          title="Android 중국 버전"
          :version="latestPatchVersion ?? '확인 중'"
          :release-date="latestPatchRelease ? formatDate(latestPatchRelease.publishedAt) : '—'"
          :file-size="cnAndroidManual ? formatFileSize(cnAndroidManual.asset.size) : '—'"
          :download-count="cnAndroidDownloadCount !== null ? formatCount(cnAndroidDownloadCount) : '—'"
        >
          <template #default>
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
          </template>
        </DownloadArtifactCard>
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

    <DownloadInstallationGuides />
  </div>
</template>
