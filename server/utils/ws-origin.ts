const DEFAULT_SITE_ORIGIN = 'https://astral.maynutlab.com'

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>([DEFAULT_SITE_ORIGIN])
  for (const value of (process.env.ASTRAL_WS_ALLOWED_ORIGINS || '').split(',')) {
    const origin = normalizeOrigin(value.trim())
    if (origin) origins.add(origin)
  }
  return origins
}

const allowedOrigins = getAllowedOrigins()

function isLocalDevelopmentOrigin(origin: URL): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return origin.hostname === 'localhost'
    || origin.hostname === '127.0.0.1'
    || origin.hostname === '[::1]'
    || origin.hostname === '::1'
}

export function isAllowedWebSocketOrigin(originHeader: string | null): boolean {
  if (!originHeader) return process.env.NODE_ENV !== 'production'
  try {
    const origin = new URL(originHeader)
    return allowedOrigins.has(origin.origin) || isLocalDevelopmentOrigin(origin)
  } catch {
    return false
  }
}

export function getTrustedClientIp(realIp: string | null | undefined, remoteAddress: string | undefined): string {
  if (process.env.ASTRAL_TRUST_PROXY === 'true') return realIp?.trim() || remoteAddress || 'unknown'
  return remoteAddress || 'unknown'
}
