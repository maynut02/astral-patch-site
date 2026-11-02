import type { UserRole } from './user'

export interface ContributorListItem {
  id: string
  handle: string | null
  role: UserRole
  translationCount: number
  approvedTranslationCount: number
}

export interface ContributorListResponse {
  contributors: ContributorListItem[]
  total: number
}
