// API 오류 객체에서 사용자에게 표시할 메시지를 추출한다.
export function getRequestErrorMessage(error: unknown, fallback: string): string
export function getRequestErrorMessage(error: unknown, fallback?: undefined): string | undefined
export function getRequestErrorMessage(error: unknown, fallback?: string): string | undefined {
  if (!error || typeof error !== 'object') {
    return fallback
  }

  const payload = error as {
    data?: { statusMessage?: unknown, message?: unknown }
    statusMessage?: unknown
    message?: unknown
  }
  const candidates = [
    payload.data?.statusMessage,
    payload.data?.message,
    payload.statusMessage,
    payload.message
  ]

  return candidates.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    || fallback
}

// $fetch/useFetch 오류에서 HTTP 상태 코드를 추출한다.
export function getRequestErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const payload = error as {
    status?: unknown
    statusCode?: unknown
    data?: { statusCode?: unknown }
  }
  const candidates = [payload.status, payload.statusCode, payload.data?.statusCode]

  return candidates.find((value): value is number => typeof value === 'number')
}
