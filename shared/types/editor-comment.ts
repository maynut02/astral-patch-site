import type { UserRole } from './user'

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
