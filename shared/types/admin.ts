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
