import type { ReleaseAssetInfo, ReleaseNoteEntry } from '#shared/types/releases'

interface GitHubReleaseAsset {
  id?: unknown
  name?: unknown
  content_type?: unknown
  size?: unknown
  download_count?: unknown
  created_at?: unknown
  updated_at?: unknown
  browser_download_url?: unknown
}

export interface GitHubRelease {
  id?: unknown
  tag_name?: unknown
  name?: unknown
  body?: unknown
  html_url?: unknown
  prerelease?: unknown
  draft?: unknown
  created_at?: unknown
  published_at?: unknown
  assets?: unknown
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAsset(value: unknown): ReleaseAssetInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const asset = value as GitHubReleaseAsset
  const name = asString(asset.name)
  const downloadUrl = asString(asset.browser_download_url)

  if (!name || !downloadUrl) {
    return null
  }

  return {
    id: asNumber(asset.id),
    name,
    contentType: asString(asset.content_type),
    size: asNumber(asset.size),
    downloadCount: asNumber(asset.download_count),
    createdAt: asString(asset.created_at),
    updatedAt: asString(asset.updated_at),
    downloadUrl
  }
}

function normalizeRelease(value: unknown): ReleaseNoteEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const release = value as GitHubRelease
  const tagName = asString(release.tag_name)
  const url = asString(release.html_url)

  if (!tagName || !url || release.draft === true) {
    return null
  }

  const assets = Array.isArray(release.assets)
    ? release.assets.map(normalizeAsset).filter((asset): asset is ReleaseAssetInfo => Boolean(asset))
    : []

  return {
    id: asNumber(release.id),
    tagName,
    title: asString(release.name) || tagName,
    body: asString(release.body),
    url,
    prerelease: release.prerelease === true,
    createdAt: asString(release.created_at),
    publishedAt: asString(release.published_at) || asString(release.created_at),
    assets
  }
}

export function normalizeReleases(rows: GitHubRelease[]): ReleaseNoteEntry[] {
  return rows
    .map(normalizeRelease)
    .filter((release): release is ReleaseNoteEntry => Boolean(release))
}
