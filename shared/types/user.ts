export const USER_ROLES = ['admin', 'verified', 'user', 'bot'] as const

export type UserRole = typeof USER_ROLES[number]

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLES.includes(value as UserRole)
}

export function resolveUserRole(value: unknown): UserRole {
  return isUserRole(value) ? value : 'user'
}

// 번역 검토(승인/반려) 권한이 있는 역할.
export function isReviewerRole(value: unknown): value is 'admin' | 'verified' {
  return value === 'admin' || value === 'verified'
}

export const BOT_GOOGLE_SUB = 'bot'
export const BOT_HANDLE = 'Bot'
export const MANAGEABLE_USER_ROLES = ['admin', 'verified', 'user'] as const

export function isManageableUserRole(value: unknown): value is typeof MANAGEABLE_USER_ROLES[number] {
  return typeof value === 'string' && MANAGEABLE_USER_ROLES.includes(value as typeof MANAGEABLE_USER_ROLES[number])
}

export function isReservedBotAccount(id: string, role: unknown): boolean {
  return id === BOT_GOOGLE_SUB || role === 'bot'
}
