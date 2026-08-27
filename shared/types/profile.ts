export type ProfileUserRole = 'admin' | 'verified' | 'user' | 'bot'

export interface UserSocialLink {
  id: string
  label: string
  url: string
}

export interface UserProfileDetails {
  handle: string
  role: ProfileUserRole
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
