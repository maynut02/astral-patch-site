import type { UserRole } from './user'

export const EDITOR_COMMENT_MAX_LENGTH = 2_000

export interface EditorComment {
  id: string
  unitId: string
  itemKey: string
  authorHandle: string | null
  authorRole: UserRole
  body: string
  createdAt: string
}

export interface EditorCommentsResponse {
  comments: EditorComment[]
  nextCursor: string | null
}
