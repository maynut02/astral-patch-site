import type { UserRole } from './user'

export const HANDLE_MAX_LENGTH = 20
export const HANDLE_CHARACTER_PATTERN = /^[A-Za-z0-9]+$/
export const HANDLE_PATTERN = new RegExp(`^[A-Za-z0-9]{1,${HANDLE_MAX_LENGTH}}$`)
export const GAME_PROFILE_VALUE_MAX_LENGTH = 64
export const SOCIAL_LINK_LABEL_MAX_LENGTH = 30
export const SOCIAL_LINK_URL_MAX_LENGTH = 500
export const SOCIAL_LINK_MAX_COUNT = 10

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
