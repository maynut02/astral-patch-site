export type ReleaseFeedKey = 'patch' | 'windowsPatcher' | 'androidPatcher' | 'androidApk'

export type PatchRoute = 'INT_STEAM' | 'CN_STEAM' | 'INT_ANDROID'
export type PatchChannel = 'develop' | 'release'

export interface ReleaseAssetInfo {
  id: number
  name: string
  contentType: string
  size: number
  downloadCount: number
  createdAt: string
  updatedAt: string
  downloadUrl: string
}

export interface ReleaseNoteEntry {
  id: number
  tagName: string
  title: string
  body: string
  url: string
  prerelease: boolean
  createdAt: string
  publishedAt: string
  assets: ReleaseAssetInfo[]
}

export interface PatchDistributionEntry {
  route: PatchRoute
  channel: PatchChannel
  gameVersion: string
  revision: string
  patchVersion: string
  manifestUrl: string
  manifestSha256: string
  catalogHash: string
  addressablesPaths?: string[]
}

export interface PatchDistributionIndex {
  schemaVersion: number
  releases: PatchDistributionEntry[]
}

export interface WindowsPatcherIndex {
  schemaVersion: number
  version: string
  downloadUrl: string
  sha256: string
  size: number
}

export interface AndroidPatcherIndex {
  version: string
  versionCode: number
  downloadUrl: string
  sha256: string
  size: number
}

export interface AndroidApkIndex {
  schemaVersion: number
  packageName: string
  gameVersion: string
  downloadUrl: string
  sha256: string
  size: number
  installerPackageName: string
}

export interface IndexedReleaseArtifact<T> {
  index: T
  release: ReleaseNoteEntry | null
  asset: ReleaseAssetInfo | null
}

export interface StablePatchDistribution {
  patchVersion: string
  release: ReleaseNoteEntry | null
}

export interface ReleaseDistribution {
  patchIndex: PatchDistributionIndex | null
  stablePatch: StablePatchDistribution | null
  windowsPatcher: IndexedReleaseArtifact<WindowsPatcherIndex> | null
  androidPatcher: IndexedReleaseArtifact<AndroidPatcherIndex> | null
  androidApk: IndexedReleaseArtifact<AndroidApkIndex> | null
}

export interface ReleaseFeedResponse {
  repository: string
  fetchedAt: string
  releases: Record<ReleaseFeedKey, ReleaseNoteEntry[]>
  distribution: ReleaseDistribution
}

export interface ReleaseHistoryPageResponse {
  repository: string
  fetchedAt: string
  page: number
  perPage: number
  hasMore: boolean
  releases: Record<ReleaseFeedKey, ReleaseNoteEntry[]>
}
