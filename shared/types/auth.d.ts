import type { UserRole } from './user'

declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    handle: string | null
    role: UserRole
  }

  interface UserSession {
    loggedInAt?: number
  }
}

export {}
