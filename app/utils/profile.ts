export const HANDLE_MAX_LENGTH = 20

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
