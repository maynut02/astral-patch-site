import type { DatabaseClient } from './database'

export interface RateLimitWindow {
  name: string
  limit: number
  windowMs: number
}

export async function isRateLimited(
  database: DatabaseClient,
  bucketKey: string,
  windows: readonly RateLimitWindow[],
  cost = 1
): Promise<boolean> {
  if (!Number.isSafeInteger(cost) || cost < 1) {
    throw new TypeError('Rate limit cost must be a positive integer')
  }

  const now = Date.now()

  for (const window of windows) {
    const windowStart = Math.floor(now / window.windowMs) * window.windowMs
    const windowKey = `${window.name}:${windowStart}`
    const expiresAt = new Date(windowStart + window.windowMs)
    const [row] = await database<{ count: number }[]>`
      INSERT INTO request_rate_limit_counters (bucket_key, window_key, count, expires_at)
      VALUES (${bucketKey}, ${windowKey}, ${cost}, ${expiresAt})
      ON CONFLICT (bucket_key, window_key) DO UPDATE
      SET count = request_rate_limit_counters.count + ${cost}
      RETURNING count
    `

    if (Number(row?.count || 0) > window.limit) {
      return true
    }
  }

  if (Math.random() < 0.01) {
    void database`DELETE FROM request_rate_limit_counters WHERE expires_at < now()`
      .catch(() => undefined)
  }

  return false
}
