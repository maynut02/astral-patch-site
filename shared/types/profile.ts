import type { UserRole } from './user'

export type ProfileUserRole = UserRole

export interface UserSocialLink {
  id: string
  label: string
  url: string
}

export interface UserProfileDetails {
  handle: string
  role: UserRole
  gameUid: string | null
  gameInviteCode: string | null
  socialLinks: UserSocialLink[]
}

export interface EditableUserProfile {
  handle: string
  gameUid: string | null
  gameInviteCode: string | null
  socialLinks: UserSocialLink[]
}
