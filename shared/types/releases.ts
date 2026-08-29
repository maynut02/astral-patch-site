export type ReleaseFeedKey = 'version' | 'autopatcher' | 'apk'

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

export interface ReleaseFeedResponse {
  repository: string
  fetchedAt: string
  releases: Record<ReleaseFeedKey, ReleaseNoteEntry[]>
}
