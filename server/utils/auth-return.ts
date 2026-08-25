import type { H3Event } from 'h3'
import { deleteCookie, getCookie, setCookie } from 'h3'

const AUTH_RETURN_COOKIE = 'auth-return-to'
const FALLBACK_RETURN_PATH = '/'
const BLOCKED_RETURN_PATHS = [
  '/auth/google',
  '/auth/login',
  '/auth/continue',
  '/setup'
]

export function sanitizeAuthReturnTo(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value

  if (typeof candidate !== 'string') {
    return FALLBACK_RETURN_PATH
  }

  const path = candidate.trim()

  if (!path.startsWith('/') || path.startsWith('//')) {
    return FALLBACK_RETURN_PATH
  }

  try {
    const url = new URL(path, 'http://localhost')

    if (url.origin !== 'http://localhost') {
      return FALLBACK_RETURN_PATH
    }

    if (BLOCKED_RETURN_PATHS.some(blockedPath =>
      url.pathname === blockedPath || url.pathname.startsWith(`${blockedPath}/`)
    )) {
      return FALLBACK_RETURN_PATH
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return FALLBACK_RETURN_PATH
  }
}

export function setAuthReturnTo(event: H3Event, value: unknown): void {
  setCookie(event, AUTH_RETURN_COOKIE, sanitizeAuthReturnTo(value), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60
  })
}

export function consumeAuthReturnTo(event: H3Event): string {
  const returnTo = sanitizeAuthReturnTo(getCookie(event, AUTH_RETURN_COOKIE))

  deleteCookie(event, AUTH_RETURN_COOKIE, { path: '/' })

  return returnTo
}

export function withAuthError(returnTo: string): string {
  const url = new URL(sanitizeAuthReturnTo(returnTo), 'http://localhost')
  url.searchParams.set('authError', 'google')

  return `${url.pathname}${url.search}${url.hash}`
}
