export type UserRole = 'admin' | 'verified' | 'user' | 'bot'

export interface UserRoleMeta {
  icon: string
  label: string
}

const USER_ROLE_META: Partial<Record<UserRole, UserRoleMeta>> = {
  admin: {
    icon: 'i-tabler-shield-check-filled',
    label: '관리자'
  },
  verified: {
    icon: 'i-tabler-rosette-discount-check-filled',
    label: '인증된 사용자'
  },
  bot: {
    icon: 'i-tabler-code',
    label: '봇'
  }
}

export function getUserRoleMeta(role: unknown): UserRoleMeta | null {
  return typeof role === 'string' && role in USER_ROLE_META
    ? USER_ROLE_META[role as UserRole] ?? null
    : null
}

export function hasUserRoleIcon(role: unknown): boolean {
  return getUserRoleMeta(role) !== null
}
