import { createError } from 'h3'
import type {
  ReleaseAssetInfo,
  ReleaseFeedResponse,
  ReleaseNoteEntry
} from '#shared/types/releases'

const GITHUB_REPOSITORY = 'maynut02/astral-party-korean-patch'
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases`
const GITHUB_PAGE_SIZE = 100
const GITHUB_MAX_PAGES = 10

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

interface GitHubRelease {
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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

function hasAsset(release: ReleaseNoteEntry, predicate: (asset: ReleaseAssetInfo) => boolean): boolean {
  return release.assets.some(predicate)
}

function isAutoPatcherRelease(release: ReleaseNoteEntry): boolean {
  return release.tagName.startsWith('patcher-v')
    || hasAsset(release, asset => asset.name.toLowerCase() === 'astralautopatcher.exe')
}

function isAndroidApkRelease(release: ReleaseNoteEntry): boolean {
  return release.tagName.startsWith('int-android-v')
    || hasAsset(release, asset => asset.name.toLowerCase() === 'astralparty_int_android.apk')
}

function isVersionRelease(release: ReleaseNoteEntry): boolean {
  return release.assets.some((asset) => {
    const name = asset.name.toLowerCase()
    return name === 'int_steam_manifest.json'
      || name === 'cn_steam_manifest.json'
      || name === 'int_android_manifest.json'
      || name.startsWith('int-steam-')
      || name.startsWith('cn-steam-')
      || name.startsWith('int-android-')
  })
}

async function fetchReleasePage(page: number): Promise<GitHubRelease[]> {
  try {
    return await $fetch<GitHubRelease[]>(GITHUB_RELEASES_API, {
      query: {
        per_page: GITHUB_PAGE_SIZE,
        page
      },
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'astral-patch-site',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      retry: 1,
      timeout: 10_000
    })
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'GitHub release information could not be loaded'
    })
  }
}

async function fetchAllGitHubReleases(): Promise<ReleaseNoteEntry[]> {
  const releases: ReleaseNoteEntry[] = []

  for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
    const rows = await fetchReleasePage(page)
    releases.push(...rows.map(normalizeRelease).filter((release): release is ReleaseNoteEntry => Boolean(release)))

    if (rows.length < GITHUB_PAGE_SIZE) {
      break
    }
  }

  return releases
}

export async function getReleaseFeed(): Promise<ReleaseFeedResponse> {
  const source = await fetchAllGitHubReleases()
  const releases: ReleaseFeedResponse['releases'] = {
    version: [],
    autopatcher: [],
    apk: []
  }

  for (const release of source) {
    if (isAutoPatcherRelease(release)) {
      releases.autopatcher.push(release)
      continue
    }

    if (isAndroidApkRelease(release)) {
      releases.apk.push(release)
      continue
    }

    if (isVersionRelease(release)) {
      releases.version.push(release)
    }
  }

  return {
    repository: GITHUB_REPOSITORY,
    fetchedAt: new Date().toISOString(),
    releases
  }
}
