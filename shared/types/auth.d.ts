declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string
    avatarUrl: string
    role: 'admin' | 'user'
  }

  interface UserSession {
    loggedInAt?: number
  }
}

export {}
