export const USER_ROLES = ['admin', 'verified', 'user', 'bot'] as const

export type UserRole = typeof USER_ROLES[number]

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLES.includes(value as UserRole)
}

export function resolveUserRole(value: unknown): UserRole {
  return isUserRole(value) ? value : 'user'
}
