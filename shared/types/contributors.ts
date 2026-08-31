import type { UserRole } from './user'

export interface ContributorListItem {
  handle: string
  role: UserRole
  translationCount: number
  approvedTranslationCount: number
}

export interface ContributorListResponse {
  contributors: ContributorListItem[]
  total: number
}
