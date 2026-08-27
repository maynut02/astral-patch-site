export const HANDLE_MAX_LENGTH = 20
export const GAME_PROFILE_VALUE_MAX_LENGTH = 64
export const SOCIAL_LINK_LABEL_MAX_LENGTH = 30
export const SOCIAL_LINK_URL_MAX_LENGTH = 500
export const SOCIAL_LINK_MAX_COUNT = 10

const HANDLE_PATTERN = /^[A-Za-z0-9]+$/

export function normalizeHandle(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function validateHandle(value: string): string {
  const handle = normalizeHandle(value)

  if (!handle) {
    return '핸들을 입력해 주세요.'
  }

  if (!HANDLE_PATTERN.test(handle)) {
    return '핸들은 영문과 숫자만 사용할 수 있어요.'
  }

  if (Array.from(handle).length > HANDLE_MAX_LENGTH) {
    return `핸들은 ${HANDLE_MAX_LENGTH}자 이내로 입력해 주세요.`
  }

  return ''
}

export function sanitizeGameUid(value: unknown): string {
  return String(value ?? '').replace(/[^0-9]/g, '').slice(0, GAME_PROFILE_VALUE_MAX_LENGTH)
}

export function sanitizeGameInviteCode(value: unknown): string {
  return String(value ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, GAME_PROFILE_VALUE_MAX_LENGTH)
}

export function validateGameUid(value: string): string {
  const normalized = value.trim()

  if (!normalized) {
    return ''
  }

  if (!/^[0-9]+$/.test(normalized)) {
    return '게임 UID는 숫자만 사용할 수 있어요.'
  }

  if (Array.from(normalized).length > GAME_PROFILE_VALUE_MAX_LENGTH) {
    return `게임 UID는 ${GAME_PROFILE_VALUE_MAX_LENGTH}자 이내로 입력해 주세요.`
  }

  return ''
}

export function validateGameInviteCode(value: string): string {
  const normalized = value.trim()

  if (!normalized) {
    return ''
  }

  if (!/^[A-Za-z0-9]+$/.test(normalized)) {
    return '게임 초대 코드는 영문과 숫자만 사용할 수 있어요.'
  }

  if (Array.from(normalized).length > GAME_PROFILE_VALUE_MAX_LENGTH) {
    return `게임 초대 코드는 ${GAME_PROFILE_VALUE_MAX_LENGTH}자 이내로 입력해 주세요.`
  }

  return ''
}

export function validateSocialLink(label: string, url: string): { label: string, url: string } {
  const normalizedLabel = label.trim()
  const normalizedUrl = url.trim()
  let labelError = ''
  let urlError = ''

  if (!normalizedLabel) {
    labelError = '이름을 입력해 주세요.'
  } else if (Array.from(normalizedLabel).length > SOCIAL_LINK_LABEL_MAX_LENGTH) {
    labelError = `이름은 ${SOCIAL_LINK_LABEL_MAX_LENGTH}자 이내로 입력해 주세요.`
  }

  if (!normalizedUrl) {
    urlError = 'URL을 입력해 주세요.'
  } else if (Array.from(normalizedUrl).length > SOCIAL_LINK_URL_MAX_LENGTH) {
    urlError = `URL은 ${SOCIAL_LINK_URL_MAX_LENGTH}자 이내로 입력해 주세요.`
  } else {
    try {
      const parsed = new URL(normalizedUrl)

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        urlError = 'http:// 또는 https:// 주소만 사용할 수 있어요.'
      }
    } catch {
      urlError = '올바른 URL을 입력해 주세요.'
    }
  }

  return { label: labelError, url: urlError }
}

const SOCIAL_LINK_BRANDS: Array<{ domains: string[], icon: string }> = [
  { domains: ['x.com', 'twitter.com'], icon: 'i-tabler-brand-x' },
  { domains: ['youtube.com', 'youtu.be'], icon: 'i-tabler-brand-youtube-filled' },
  { domains: ['discord.com', 'discord.gg'], icon: 'i-tabler-brand-discord-filled' },
  { domains: ['github.com'], icon: 'i-tabler-brand-github-filled' },
  { domains: ['twitch.tv'], icon: 'i-tabler-brand-twitch-filled' },
  { domains: ['instagram.com'], icon: 'i-tabler-brand-instagram' },
  { domains: ['facebook.com', 'fb.com'], icon: 'i-tabler-brand-facebook-filled' },
  { domains: ['tiktok.com'], icon: 'i-tabler-brand-tiktok-filled' },
  { domains: ['bsky.app'], icon: 'i-tabler-brand-bluesky-filled' },
  { domains: ['reddit.com'], icon: 'i-tabler-brand-reddit-filled' },
  { domains: ['steamcommunity.com', 'steampowered.com'], icon: 'i-tabler-brand-steam-filled' },
  { domains: ['t.me', 'telegram.me'], icon: 'i-tabler-brand-telegram-filled' },
  { domains: ['line.me'], icon: 'i-tabler-brand-line-filled' }
]

function matchesSocialDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export function getSocialLinkIcon(value: string): string | null {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '')
    const brand = SOCIAL_LINK_BRANDS.find(item => item.domains.some(domain => matchesSocialDomain(hostname, domain)))

    return brand?.icon ?? null
  } catch {
    return null
  }
}

export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  if ('status' in error && typeof error.status === 'number') {
    return error.status
  }

  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }

  return undefined
}

export function formatHandle(value: unknown, fallback = '@handle'): string {
  const handle = normalizeHandle(value)

  return handle ? `@${handle}` : fallback
}

export function getHandleInitial(value: unknown): string {
  const handle = normalizeHandle(value)

  return Array.from(handle || 'U')[0]?.toLocaleUpperCase() ?? 'U'
}

export function getPublicProfilePath(value: unknown, fallback = '/'): string {
  const handle = normalizeHandle(value)

  return handle ? `/@${encodeURIComponent(handle)}` : fallback
}
