// API 오류 객체에서 사용자에게 표시할 메시지를 추출한다.
export function getRequestErrorMessage(error: unknown, fallback: string): string {
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
