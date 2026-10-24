import type { ReleaseFeedResponse } from '#shared/types/releases'
import { computed, type Ref } from 'vue'
import { getLatestPatchRelease } from '~/utils/release-assets'

export function useReleaseFeed(key: string) {
  return useFetch<ReleaseFeedResponse>('/api/releases', { key })
}

export function useReleaseDistribution(feed: Ref<ReleaseFeedResponse | null | undefined>) {
  const windowsPatcher = computed(() => feed.value?.distribution.windowsPatcher ?? null)
  const windowsPlugin = computed(() => feed.value?.distribution.windowsPlugin ?? null)
  const androidPatcher = computed(() => feed.value?.distribution.androidPatcher ?? null)
  const latestPatchRelease = computed(() => getLatestPatchRelease(feed.value))
  const latestPatchVersion = computed(() =>
    feed.value?.distribution.stablePatch?.patchVersion
    ?? latestPatchRelease.value?.tagName
    ?? null
  )

  return { windowsPatcher, windowsPlugin, androidPatcher, latestPatchRelease, latestPatchVersion }
}
