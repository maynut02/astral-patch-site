import type { UserRole } from './user'

export const NOTICE_TITLE_MAX_LENGTH = 160
export const NOTICE_BODY_MAX_LENGTH = 10_000

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
