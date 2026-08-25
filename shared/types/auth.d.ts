declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    handle: string | null
    role: 'admin' | 'verified' | 'user' | 'bot'
  }

  interface UserSession {
    loggedInAt?: number
  }
}

export {}
