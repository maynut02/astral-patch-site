import type {
  AndroidPatcherIndex,
  IndexedReleaseArtifact,
  PatchDistributionEntry,
  PatchDistributionIndex,
  ReleaseAssetInfo,
  ReleaseFeedResponse,
  ReleaseHistoryPageResponse,
  ReleaseNoteEntry,
  WindowsPatcherIndex,
  WindowsPluginIndex
} from '#shared/types/releases'
import { fetchDistributionJson, fetchReleasePage, GITHUB_PAGE_SIZE } from './github/client'
import { asNumber, asString, isRecord, normalizeReleases } from './github/normalizers'

const PATCH_REPOSITORY = 'maynut02/astral-party-korean-patch'
const PATCHER_REPOSITORY = 'maynut02/astral-party-auto-patcher'
const PLUGIN_REPOSITORY = 'maynut02/astral-party-korean-plugin'
const PLUGIN_ASSET_PATTERN = /^astralpartykoreanplugin-v.+\.zip$/i
const GITHUB_MAX_PAGES = 10
const PATCH_RELEASE_TAG_PATTERN = /^v[^_]+_r\d+(?:_p\d+)?$/

const RELEASE_REPOSITORIES = {
  patch: PATCH_REPOSITORY,
  patcher: PATCHER_REPOSITORY,
  plugin: PLUGIN_REPOSITORY
} as const

function hasAsset(release: ReleaseNoteEntry, predicate: (asset: ReleaseAssetInfo) => boolean): boolean {
  return release.assets.some(predicate)
}

function isWindowsPatcherRelease(release: ReleaseNoteEntry): boolean {
  return release.tagName.startsWith('windows-patcher-v')
    || hasAsset(release, asset => asset.name.toLowerCase() === 'astralwindowspatcher.exe')
}

function isWindowsPluginRelease(release: ReleaseNoteEntry): boolean {
  return hasAsset(release, asset => PLUGIN_ASSET_PATTERN.test(asset.name))
}

function isAndroidPatcherRelease(release: ReleaseNoteEntry): boolean {
  return release.tagName.startsWith('android-patcher-v')
    || hasAsset(release, asset => asset.name.toLowerCase() === 'astralandroidpatcher.apk')
}

function isPatchRelease(release: ReleaseNoteEntry): boolean {
  return !release.prerelease && PATCH_RELEASE_TAG_PATTERN.test(release.tagName)
}

function sortReleases(releases: ReleaseNoteEntry[]): ReleaseNoteEntry[] {
  return releases.sort((left, right) => {
    const leftTime = new Date(left.publishedAt).getTime()
    const rightTime = new Date(right.publishedAt).getTime()
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
  })
}

function classifyReleases(
  patchSource: ReleaseNoteEntry[],
  patcherSource: ReleaseNoteEntry[],
  pluginSource: ReleaseNoteEntry[]
): ReleaseFeedResponse['releases'] {
  return {
    patch: sortReleases(patchSource.filter(isPatchRelease)),
    windowsPlugin: sortReleases(pluginSource.filter(isWindowsPluginRelease)),
    windowsPatcher: sortReleases(patcherSource.filter(isWindowsPatcherRelease)),
    androidPatcher: sortReleases(patcherSource.filter(isAndroidPatcherRelease))
  }
}

function hasIndexedAsset(releases: ReleaseNoteEntry[], downloadUrl: string): boolean {
  if (!downloadUrl) {
    return releases.length > 0
  }

  return releases.some(release => hasAsset(release, asset => asset.downloadUrl === downloadUrl))
}

async function fetchReleasesUntil(
  repository: string,
  hasRequiredReleases: (releases: ReleaseNoteEntry[]) => boolean
): Promise<ReleaseNoteEntry[]> {
  const releases: ReleaseNoteEntry[] = []
  // 종료 조건 이후의 페이지는 조회하지 않아 기존 실패 범위와 반환 목록을 유지한다.
  for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
    const rows = await fetchReleasePage(repository, page)
    releases.push(...normalizeReleases(rows))
    if (rows.length < GITHUB_PAGE_SIZE || hasRequiredReleases(releases)) break
  }
  return releases
}

function fetchRequiredPatchReleases(stablePatchVersions: Set<string>): Promise<ReleaseNoteEntry[]> {
  return fetchReleasesUntil(PATCH_REPOSITORY, (releases) => {
    const patchReleases = releases.filter(isPatchRelease)
    return stablePatchVersions.size > 0
      ? patchReleases.some(release => stablePatchVersions.has(release.tagName))
      : patchReleases.length > 0
  })
}

function fetchRequiredPatcherReleases(
  windowsPatcherDownloadUrl: string,
  androidPatcherDownloadUrl: string
): Promise<ReleaseNoteEntry[]> {
  return fetchReleasesUntil(PATCHER_REPOSITORY, releases => (
    hasIndexedAsset(releases.filter(isWindowsPatcherRelease), windowsPatcherDownloadUrl)
    && hasIndexedAsset(releases.filter(isAndroidPatcherRelease), androidPatcherDownloadUrl)
  ))
}

function fetchRequiredPluginReleases(): Promise<ReleaseNoteEntry[]> {
  return fetchReleasesUntil(PLUGIN_REPOSITORY, releases => (
    releases.some(release => !release.prerelease && isWindowsPluginRelease(release))
  ))
}

export async function getReleaseHistoryPage(page: number): Promise<ReleaseHistoryPageResponse> {
  const normalizedPage = Math.max(1, Math.floor(page))
  const [patchRows, patcherRows, pluginRows] = await Promise.all([
    fetchReleasePage(PATCH_REPOSITORY, normalizedPage),
    fetchReleasePage(PATCHER_REPOSITORY, normalizedPage),
    fetchReleasePage(PLUGIN_REPOSITORY, normalizedPage)
  ])

  return {
    repositories: RELEASE_REPOSITORIES,
    fetchedAt: new Date().toISOString(),
    page: normalizedPage,
    perPage: GITHUB_PAGE_SIZE * 3,
    hasMore: [patchRows, patcherRows, pluginRows].some(rows => rows.length === GITHUB_PAGE_SIZE),
    releases: classifyReleases(
      normalizeReleases(patchRows),
      normalizeReleases(patcherRows),
      normalizeReleases(pluginRows)
    )
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
    (route !== 'INT_STEAM' && route !== 'CN_STEAM' && route !== 'INT_ANDROID' && route !== 'CN_ANDROID')
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

function resolveWindowsPlugin(
  releases: ReleaseNoteEntry[]
): IndexedReleaseArtifact<WindowsPluginIndex> | null {
  const candidates = sortReleases(releases.filter(release => !release.prerelease && isWindowsPluginRelease(release)))

  for (const release of candidates) {
    const asset = release.assets.find(item => PLUGIN_ASSET_PATTERN.test(item.name))
    if (!asset) {
      continue
    }

    return {
      index: {
        version: versionFromTag(release.tagName, 'v'),
        downloadUrl: asset.downloadUrl,
        size: asset.size
      },
      release,
      asset
    }
  }

  return null
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

export async function getReleaseFeed(): Promise<ReleaseFeedResponse> {
  const [patchIndexRaw, windowsPatcherRaw, androidPatcherRaw] = await Promise.all([
    fetchDistributionJson(PATCH_REPOSITORY, 'release-index.json'),
    fetchDistributionJson(PATCHER_REPOSITORY, 'patcher-index.json'),
    fetchDistributionJson(PATCHER_REPOSITORY, 'mobile-patcher-index.json')
  ])

  const patchIndex = normalizePatchDistributionIndex(patchIndexRaw)
  const windowsPatcherIndex = normalizeWindowsPatcherIndex(windowsPatcherRaw)
  const androidPatcherIndex = normalizeAndroidPatcherIndex(androidPatcherRaw)
  const stablePatchVersions = new Set(
    patchIndex?.releases
      .filter(entry => entry.channel === 'release')
      .map(entry => entry.patchVersion)
      ?? []
  )

  const [patchSource, patcherSource, pluginSource] = await Promise.all([
    fetchRequiredPatchReleases(stablePatchVersions),
    fetchRequiredPatcherReleases(
      windowsPatcherIndex?.downloadUrl ?? '',
      androidPatcherIndex?.downloadUrl ?? ''
    ),
    fetchRequiredPluginReleases()
  ])
  const releases = classifyReleases(patchSource, patcherSource, pluginSource)

  const stablePatchRelease = stablePatchVersions.size
    ? releases.patch.find(release => stablePatchVersions.has(release.tagName)) ?? null
    : releases.patch[0] ?? null
  const stablePatchVersion = stablePatchRelease?.tagName ?? null

  return {
    repositories: RELEASE_REPOSITORIES,
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
      windowsPlugin: resolveWindowsPlugin(releases.windowsPlugin),
      androidPatcher: resolveAndroidPatcher(androidPatcherIndex, releases.androidPatcher)
    }
  }
}
