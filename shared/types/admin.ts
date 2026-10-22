import type { UserRole } from './user'

export interface AdminUserEntry {
  id: string
  email: string
  handle: string | null
  role: UserRole
  createdAt: string
  lastLoginAt: string | null
}

export interface AdminUsersResponse {
  users: AdminUserEntry[]
  total: number
}

export interface AdminUserRoleUpdateResponse {
  id: string
  role: UserRole
}

export interface AdminPatchWatcherConfig {
  gameVersion: string
  enabled: boolean
  updatedAt: string
}

export interface AdminTranslationPackPublication {
  number: number
  gameVersion: string
  revision: string
  publishedAt: string
  publishedBy: string | null
  gzipByteSize: number
  langCount: number
  strCount: number
}

export interface AdminTranslationPackStatus {
  latest: AdminTranslationPackPublication | null
  /** Approved translation rows changed since the latest publication. Deleted rows are not counted. */
  pendingChangeCount: number
  currentGame: { gameVersion: string, revision: string } | null
}
