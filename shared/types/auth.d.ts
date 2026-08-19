declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string
    handle: string | null
    nickname: string | null
    role: 'admin' | 'user'
  }

  interface UserSession {
    loggedInAt?: number
  }
}

export {}
