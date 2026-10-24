export function statusMessageOf(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback
  const value = error as { statusMessage?: unknown, message?: unknown }
  if (typeof value.statusMessage === 'string' && value.statusMessage.trim()) return value.statusMessage
  if (typeof value.message === 'string' && value.message.trim()) return value.message
  return fallback
}
