import type { UserRole } from './user'

export interface Notice {
  id: string
  title: string
  body: string
  authorHandle: string | null
  authorRole: UserRole
  createdAt: string
}

export interface NoticesResponse {
  notices: Notice[]
}
