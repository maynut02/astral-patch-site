import { createError } from 'h3'
import type {
  AndroidApkIndex,
  AndroidPatcherIndex,
  IndexedReleaseArtifact,
  PatchDistributionEntry,
  PatchDistributionIndex,
  ReleaseAssetInfo,
  ReleaseFeedResponse,
  ReleaseHistoryPageResponse,
  ReleaseNoteEntry,
  WindowsPatcherIndex
} from '#shared/types/releases'

const GITHUB_REPOSITORY = 'maynut02/astral-party-korean-patch'
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases`
const GITHUB_CONTENTS_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents`
const GITHUB_PAGE_SIZE = 100
const GITHUB_MAX_PAGES = 10
const RECENT_RELEASE_MINIMUM = 5
const PATCH_RELEASE_TAG_PATTERN = /^v[^_]+_r\d+(?:_p\d+)?$/

function getGitHubHeaders(accept: string): Record<string, string> {
  const token = String(process.env.GITHUB_TOKEN || '').trim()
  const headers: Record<string, string> = {
    'Accept': accept,
    'User-Agent': 'astral-patch-site',
    'X-GitHub-Api-Version': '2022-11-28'
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

function getGitHubErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { message: String(error) }
  }

  const value = error as {
    message?: unknown
    status?: unknown
    statusCode?: unknown
    statusMessage?: unknown
    response?: {
      status?: unknown
      statusText?: unknown
      headers?: { get?: (name: string) => string | null }
    }
  }
  const headers = value.response?.headers

  return {
    message: typeof value.message === 'string' ? value.message : undefined,
    status: typeof value.response?.status === 'number'
      ? value.response.status
      : typeof value.statusCode === 'number'
        ? value.statusCode
        : typeof value.status === 'number'
          ? value.status
          : undefined,
    statusText: typeof value.response?.statusText === 'string'
      ? value.response.statusText
      : typeof value.statusMessage === 'string'
        ? value.statusMessage
        : undefined,
    rateLimitRemaining: headers?.get?.('x-ratelimit-remaining') ?? undefined,
    rateLimitReset: headers?.get?.('x-ratelimit-reset') ?? undefined
  }
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
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

function hasAsset(release: ReleaseNoteEntry, predicate: (asset: ReleaseAssetInfo) => boolean): boolean {
  return release.assets.some(predicate)
}

function isWindowsPatcherRelease(release: ReleaseNoteEntry): boolean {
  return release.tagName.startsWith('windows-patcher-v')
    || hasAsset(release, asset => asset.name.toLowerCase() === 'astralwindowspatcher.exe')
}

function isAndroidPatcherRelease(release: ReleaseNoteEntry): boolean {
  return release.tagName.startsWith('android-patcher-v')
    || hasAsset(release, asset => asset.name.toLowerCase() === 'astralandroidpatcher.apk')
}

function isAndroidApkRelease(release: ReleaseNoteEntry): boolean {
  return release.tagName.startsWith('int-apk-v')
    || hasAsset(release, asset => asset.name.toLowerCase() === 'astralpartykorean.apk')
}

function isPatchRelease(release: ReleaseNoteEntry): boolean {
  return !release.prerelease && PATCH_RELEASE_TAG_PATTERN.test(release.tagName)
}

function classifyReleases(source: ReleaseNoteEntry[]): ReleaseFeedResponse['releases'] {
  const releases: ReleaseFeedResponse['releases'] = {
    patch: [],
    windowsPatcher: [],
    androidPatcher: [],
    androidApk: []
  }

  for (const release of source) {
    if (isWindowsPatcherRelease(release)) {
      releases.windowsPatcher.push(release)
      continue
    }

    if (isAndroidPatcherRelease(release)) {
      releases.androidPatcher.push(release)
      continue
    }

    if (isAndroidApkRelease(release)) {
      releases.androidApk.push(release)
      continue
    }

    if (isPatchRelease(release)) {
      releases.patch.push(release)
    }
  }

  for (const key of Object.keys(releases) as Array<keyof typeof releases>) {
    sortReleases(releases[key])
  }

  return releases
}

async function fetchReleasePage(page: number): Promise<GitHubRelease[]> {
  try {
    return await $fetch<GitHubRelease[]>(GITHUB_RELEASES_API, {
      query: {
        per_page: GITHUB_PAGE_SIZE,
        page
      },
      headers: getGitHubHeaders('application/vnd.github+json'),
      retry: 1,
      timeout: 10_000
    })
  } catch (error) {
    console.error('[github-releases] GitHub releases request failed', {
      repository: GITHUB_REPOSITORY,
      page,
      ...getGitHubErrorDetails(error)
    })

    throw createError({
      statusCode: 502,
      statusMessage: 'GitHub release information could not be loaded'
    })
  }
}

interface ReleaseFetchRequirements {
  stablePatchVersions: Set<string>
  windowsPatcherDownloadUrl: string
  androidPatcherDownloadUrl: string
  androidApkDownloadUrl: string
}

function hasIndexedAsset(releases: ReleaseNoteEntry[], downloadUrl: string): boolean {
  if (!downloadUrl) {
    return releases.length > 0
  }

  return releases.some(release => hasAsset(release, asset => asset.downloadUrl === downloadUrl))
}

function hasRequiredReleases(
  source: ReleaseNoteEntry[],
  requirements: ReleaseFetchRequirements
): boolean {
  const patchReleases: ReleaseNoteEntry[] = []
  const windowsPatcherReleases: ReleaseNoteEntry[] = []
  const androidPatcherReleases: ReleaseNoteEntry[] = []
  const androidApkReleases: ReleaseNoteEntry[] = []

  for (const release of source) {
    if (isWindowsPatcherRelease(release)) {
      windowsPatcherReleases.push(release)
      continue
    }

    if (isAndroidPatcherRelease(release)) {
      androidPatcherReleases.push(release)
      continue
    }

    if (isAndroidApkRelease(release)) {
      androidApkReleases.push(release)
      continue
    }

    if (isPatchRelease(release)) {
      patchReleases.push(release)
    }
  }

  const recentReleaseCount = patchReleases.length
    + windowsPatcherReleases.length
    + androidPatcherReleases.length
    + androidApkReleases.length
  const hasStablePatch = requirements.stablePatchVersions.size > 0
    ? patchReleases.some(release => requirements.stablePatchVersions.has(release.tagName))
    : patchReleases.length > 0

  return recentReleaseCount >= RECENT_RELEASE_MINIMUM
    && hasStablePatch
    && hasIndexedAsset(windowsPatcherReleases, requirements.windowsPatcherDownloadUrl)
    && hasIndexedAsset(androidPatcherReleases, requirements.androidPatcherDownloadUrl)
    && hasIndexedAsset(androidApkReleases, requirements.androidApkDownloadUrl)
}

async function fetchRequiredGitHubReleases(requirements: ReleaseFetchRequirements): Promise<ReleaseNoteEntry[]> {
  const releases: ReleaseNoteEntry[] = []

  for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
    const rows = await fetchReleasePage(page)
    releases.push(...rows.map(normalizeRelease).filter((release): release is ReleaseNoteEntry => Boolean(release)))

    if (rows.length < GITHUB_PAGE_SIZE || hasRequiredReleases(releases, requirements)) {
      break
    }
  }

  return releases
}

export async function getReleaseHistoryPage(page: number): Promise<ReleaseHistoryPageResponse> {
  const normalizedPage = Math.max(1, Math.floor(page))
  const rows = await fetchReleasePage(normalizedPage)
  const source = rows
    .map(normalizeRelease)
    .filter((release): release is ReleaseNoteEntry => Boolean(release))

  return {
    repository: GITHUB_REPOSITORY,
    fetchedAt: new Date().toISOString(),
    page: normalizedPage,
    perPage: GITHUB_PAGE_SIZE,
    hasMore: rows.length === GITHUB_PAGE_SIZE,
    releases: classifyReleases(source)
  }
}

async function fetchDistributionJson(filename: string): Promise<unknown | null> {
  try {
    return await $fetch(`${GITHUB_CONTENTS_API}/${filename}`, {
      query: {
        ref: 'distribution'
      },
      headers: getGitHubHeaders('application/vnd.github.raw+json'),
      retry: 1,
      timeout: 10_000
    })
  } catch (error) {
    console.warn('[github-releases] GitHub distribution file request failed', {
      repository: GITHUB_REPOSITORY,
      filename,
      ...getGitHubErrorDetails(error)
    })

    return null
  }
}

function normalizePatchDistributionEntry(value: unknown): PatchDistributionEntry | null {
  if (!isRecord(value)) {
    return null
  }

  const route = asString(value.route)
  const channel = asString(value.channel)
  const gameVersion = asString(value.gameVersion)
  const revision = asString(value.revision)
  const patchVersion = asString(value.patchVersion)
  const manifestUrl = asString(value.manifestUrl)
  const manifestSha256 = asString(value.manifestSha256)
  const catalogHash = asString(value.catalogHash)

  if (
    (route !== 'INT_STEAM' && route !== 'CN_STEAM' && route !== 'INT_ANDROID')
    || (channel !== 'develop' && channel !== 'release')
    || !gameVersion
    || !revision
    || !patchVersion
    || !manifestUrl
    || !manifestSha256
    || !catalogHash
  ) {
    return null
  }

  const addressablesPaths = Array.isArray(value.addressablesPaths)
    ? value.addressablesPaths.filter((item): item is string => typeof item === 'string')
    : undefined

  return {
    route,
    channel,
    gameVersion,
    revision,
    patchVersion,
    manifestUrl,
    manifestSha256,
    catalogHash,
    ...(addressablesPaths?.length ? { addressablesPaths } : {})
  }
}

function normalizePatchDistributionIndex(value: unknown): PatchDistributionIndex | null {
  if (!isRecord(value) || !Array.isArray(value.releases)) {
    return null
  }

  const releases = value.releases
    .map(normalizePatchDistributionEntry)
    .filter((entry): entry is PatchDistributionEntry => Boolean(entry))

  if (!releases.length) {
    return null
  }

  return {
    schemaVersion: asNumber(value.schemaVersion),
    releases
  }
}

function normalizeWindowsPatcherIndex(value: unknown): WindowsPatcherIndex | null {
  if (!isRecord(value)) {
    return null
  }

  const version = asString(value.version)
  const downloadUrl = asString(value.downloadUrl)
  const sha256 = asString(value.sha256)
  const size = asNumber(value.size)

  if (!version || !downloadUrl || !sha256 || size <= 0) {
    return null
  }

  return {
    schemaVersion: asNumber(value.schemaVersion),
    version,
    downloadUrl,
    sha256,
    size
  }
}

function normalizeAndroidPatcherIndex(value: unknown): AndroidPatcherIndex | null {
  if (!isRecord(value)) {
    return null
  }

  const version = asString(value.version)
  const versionCode = asNumber(value.versionCode)
  const downloadUrl = asString(value.downloadUrl)
  const sha256 = asString(value.sha256)
  const size = asNumber(value.size)

  if (!version || versionCode <= 0 || !downloadUrl || !sha256 || size <= 0) {
    return null
  }

  return {
    version,
    versionCode,
    downloadUrl,
    sha256,
    size
  }
}

function normalizeAndroidApkIndex(value: unknown): AndroidApkIndex | null {
  if (!isRecord(value)) {
    return null
  }

  const packageName = asString(value.packageName)
  const gameVersion = asString(value.gameVersion)
  const downloadUrl = asString(value.downloadUrl)
  const sha256 = asString(value.sha256)
  const size = asNumber(value.size)
  const installerPackageName = asString(value.installerPackageName)

  if (!packageName || !gameVersion || !downloadUrl || !sha256 || size <= 0 || !installerPackageName) {
    return null
  }

  return {
    schemaVersion: asNumber(value.schemaVersion),
    packageName,
    gameVersion,
    downloadUrl,
    sha256,
    size,
    installerPackageName
  }
}

function sortReleases(releases: ReleaseNoteEntry[]): ReleaseNoteEntry[] {
  return releases.sort((left, right) => {
    const leftTime = new Date(left.publishedAt).getTime()
    const rightTime = new Date(right.publishedAt).getTime()
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
  })
}

function matchIndexedArtifact<T>(
  index: T | null,
  downloadUrl: string | undefined,
  releases: ReleaseNoteEntry[]
): IndexedReleaseArtifact<T> | null {
  if (!index || !downloadUrl) {
    return null
  }

  for (const release of releases) {
    const asset = release.assets.find(item => item.downloadUrl === downloadUrl)
    if (asset) {
      return { index, release, asset }
    }
  }

  return { index, release: null, asset: null }
}

function findLatestReleaseAsset(releases: ReleaseNoteEntry[], assetName: string): {
  release: ReleaseNoteEntry
  asset: ReleaseAssetInfo
} | null {
  const expectedName = assetName.toLowerCase()

  for (const release of releases) {
    const asset = release.assets.find(item => item.name.toLowerCase() === expectedName)
    if (asset) {
      return { release, asset }
    }
  }

  return null
}

function versionFromTag(tagName: string, prefix: string): string {
  return tagName.startsWith(prefix) ? tagName.slice(prefix.length) : tagName
}

function resolveWindowsPatcher(
  index: WindowsPatcherIndex | null,
  releases: ReleaseNoteEntry[]
): IndexedReleaseArtifact<WindowsPatcherIndex> | null {
  const indexed = matchIndexedArtifact(index, index?.downloadUrl, releases)
  if (indexed) {
    return indexed
  }

  const fallback = findLatestReleaseAsset(releases, 'AstralWindowsPatcher.exe')
  if (!fallback) {
    return null
  }

  return {
    index: {
      schemaVersion: 0,
      version: versionFromTag(fallback.release.tagName, 'windows-patcher-v'),
      downloadUrl: fallback.asset.downloadUrl,
      sha256: '',
      size: fallback.asset.size
    },
    ...fallback
  }
}

function resolveAndroidPatcher(
  index: AndroidPatcherIndex | null,
  releases: ReleaseNoteEntry[]
): IndexedReleaseArtifact<AndroidPatcherIndex> | null {
  const indexed = matchIndexedArtifact(index, index?.downloadUrl, releases)
  if (indexed) {
    return indexed
  }

  const fallback = findLatestReleaseAsset(releases, 'AstralAndroidPatcher.apk')
  if (!fallback) {
    return null
  }

  return {
    index: {
      version: versionFromTag(fallback.release.tagName, 'android-patcher-v'),
      versionCode: 0,
      downloadUrl: fallback.asset.downloadUrl,
      sha256: '',
      size: fallback.asset.size
    },
    ...fallback
  }
}

function resolveAndroidApk(
  index: AndroidApkIndex | null,
  releases: ReleaseNoteEntry[]
): IndexedReleaseArtifact<AndroidApkIndex> | null {
  const indexed = matchIndexedArtifact(index, index?.downloadUrl, releases)
  if (indexed) {
    return indexed
  }

  const fallback = findLatestReleaseAsset(releases, 'AstralPartyKorean.apk')
  if (!fallback) {
    return null
  }

  return {
    index: {
      schemaVersion: 0,
      packageName: 'com.feimo.astralpartyjpn',
      gameVersion: versionFromTag(fallback.release.tagName, 'int-apk-v'),
      downloadUrl: fallback.asset.downloadUrl,
      sha256: '',
      size: fallback.asset.size,
      installerPackageName: 'com.android.vending'
    },
    ...fallback
  }
}

export async function getReleaseFeed(): Promise<ReleaseFeedResponse> {
  const [patchIndexRaw, windowsPatcherRaw, androidPatcherRaw, androidApkRaw] = await Promise.all([
    fetchDistributionJson('release-index.json'),
    fetchDistributionJson('patcher-index.json'),
    fetchDistributionJson('mobile-patcher-index.json'),
    fetchDistributionJson('android-apk-index.json')
  ])

  const patchIndex = normalizePatchDistributionIndex(patchIndexRaw)
  const windowsPatcherIndex = normalizeWindowsPatcherIndex(windowsPatcherRaw)
  const androidPatcherIndex = normalizeAndroidPatcherIndex(androidPatcherRaw)
  const androidApkIndex = normalizeAndroidApkIndex(androidApkRaw)
  const stablePatchVersions = new Set(
    patchIndex?.releases
      .filter(entry => entry.channel === 'release')
      .map(entry => entry.patchVersion)
      ?? []
  )
  const source = await fetchRequiredGitHubReleases({
    stablePatchVersions,
    windowsPatcherDownloadUrl: windowsPatcherIndex?.downloadUrl ?? '',
    androidPatcherDownloadUrl: androidPatcherIndex?.downloadUrl ?? '',
    androidApkDownloadUrl: androidApkIndex?.downloadUrl ?? ''
  })
  const releases = classifyReleases(source)

  const stablePatchRelease = stablePatchVersions.size
    ? releases.patch.find(release => stablePatchVersions.has(release.tagName)) ?? null
    : releases.patch[0] ?? null
  const stablePatchVersion = stablePatchRelease?.tagName ?? null

  return {
    repository: GITHUB_REPOSITORY,
    fetchedAt: new Date().toISOString(),
    releases,
    distribution: {
      patchIndex,
      stablePatch: stablePatchVersion
        ? {
            patchVersion: stablePatchVersion,
            release: stablePatchRelease
          }
        : null,
      windowsPatcher: resolveWindowsPatcher(windowsPatcherIndex, releases.windowsPatcher),
      androidPatcher: resolveAndroidPatcher(androidPatcherIndex, releases.androidPatcher),
      androidApk: resolveAndroidApk(androidApkIndex, releases.androidApk)
    }
  }
}
