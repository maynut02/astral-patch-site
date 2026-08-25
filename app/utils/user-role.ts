export type UserRole = 'admin' | 'verified' | 'user' | 'bot'

export interface UserRoleMeta {
  icon: string
  label: string
}

export function getUserRoleMeta(role: unknown): UserRoleMeta | null {
  if (role === 'admin') {
    return {
      icon: 'i-tabler-shield-check-filled',
      label: '관리자'
    }
  }

  if (role === 'verified') {
    return {
      icon: 'i-tabler-rosette-discount-check-filled',
      label: '인증된 사용자'
    }
  }

  if (role === 'bot') {
    return {
      icon: 'i-tabler-code',
      label: '봇'
    }
  }

  return null
}

export function hasUserRoleIcon(role: unknown): boolean {
  return getUserRoleMeta(role) !== null
}
