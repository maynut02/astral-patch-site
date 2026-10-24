import type { ReleaseAssetInfo, ReleaseFeedResponse, ReleaseNoteEntry } from '#shared/types/releases'

export interface ReleaseAssetMatch {
  asset: ReleaseAssetInfo
  release: ReleaseNoteEntry
}

export function findAssetInRelease(release: ReleaseNoteEntry | null, assetName: string): ReleaseAssetMatch | null {
  if (!release) {
    return null
  }

  const expectedName = assetName.toLowerCase()
  const asset = release.assets.find(item => item.name.toLowerCase() === expectedName)
  return asset ? { asset, release } : null
}

export function getLatestPatchRelease(feed: ReleaseFeedResponse | null | undefined): ReleaseNoteEntry | null {
  return feed?.distribution.stablePatch?.release ?? feed?.releases.patch[0] ?? null
}
