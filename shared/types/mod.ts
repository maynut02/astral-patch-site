import type { ReleaseNoteEntry } from './releases'
import type { UserRole } from './user'

export const MOD_PLATFORMS = ['windows', 'android'] as const
export type ModPlatform = typeof MOD_PLATFORMS[number]

export interface ModEntry {
  id: string
  name: string
  summary: string
  description: string
  repository: string
  platforms: ModPlatform[]
  authorHandle: string | null
  authorRole: UserRole
  canEdit: boolean
  createdAt: string
  updatedAt: string
}

export interface ModListResponse {
  mods: ModEntry[]
}

export interface ModCommit {
  sha: string
  message: string
  author: string
  date: string
  url: string
}

export interface ModGitHubSnapshot {
  repository: string
  url: string
  description: string
  defaultBranch: string
  stars: number
  license: string | null
  archived: boolean
  pushedAt: string | null
  readme: { content: string, path: string, url: string } | null
  commits: ModCommit[]
  releases: ReleaseNoteEntry[]
  hasMoreReleases: boolean
  fetchedAt: string
  warnings: string[]
}

export interface ModDetailResponse {
  mod: ModEntry
  github: ModGitHubSnapshot | null
  githubError: string | null
}

export interface ModReleasePageResponse {
  releases: ReleaseNoteEntry[]
  page: number
  hasMore: boolean
}

export interface ModSaveInput {
  name: string
  summary: string
  description: string
  repository: string
  platforms: ModPlatform[]
}
