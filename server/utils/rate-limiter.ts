import type { DatabaseClient } from './database'
import { logServerError } from './server-log'

export interface RateLimitWindow {
  name: string
  limit: number
  windowMs: number
}

const CLEANUP_INTERVAL_MS = 5 * 60_000
let lastCleanupAt = 0

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

  if (windows.length > 0) {
    let increments = database``
    let counts = database``
    for (const [index, window] of windows.entries()) {
      const windowStart = Math.floor(now / window.windowMs) * window.windowMs
      const windowKey = `${window.name}:${windowStart}`
      const expiresAt = new Date(windowStart + window.windowMs)
      const name = database(`rate_window_${index}`)
      // 이전 창이 초과되면 뒤 창은 증가시키지 않는 기존 단락 평가를 보존한다.
      const allowed = index > 0
        ? database`NOT EXISTS (
            SELECT 1 FROM (${counts}) previous WHERE previous.count > previous."limit"
          )`
        : database`true`
      increments = database`
        ${increments}${index > 0 ? database`,` : database``}
        ${name} AS (
          INSERT INTO request_rate_limit_counters (bucket_key, window_key, count, expires_at)
          SELECT ${bucketKey}, ${windowKey}, ${cost}, ${expiresAt}
          WHERE ${allowed}
          ON CONFLICT (bucket_key, window_key) DO UPDATE
          SET count = request_rate_limit_counters.count + ${cost}
          RETURNING count
        )
      `
      counts = database`
        ${counts}${index > 0 ? database`UNION ALL` : database``}
        SELECT count, ${window.limit}::int AS "limit" FROM ${name}
      `
    }
    const rows = await database<{ count: number, limit: number }[]>`WITH ${increments} ${counts}`
    if (rows.some(row => Number(row.count || 0) > row.limit)) return true
  }

  if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS || Math.random() < 0.01) {
    lastCleanupAt = now
    void database`DELETE FROM request_rate_limit_counters WHERE expires_at < now()`
      .catch(error => logServerError('rate-limiter', 'expired counter cleanup failed', error))
  }

  return false
}
