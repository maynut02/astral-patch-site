import { createError } from 'h3'
import postgres from 'postgres'

export type DatabaseClient = ReturnType<typeof postgres>

const TRANSIENT_DATABASE_ERROR_CODES = new Set([
  'CONNECTION_CLOSED',
  'CONNECT_TIMEOUT',
  'ECONNRESET',
  'ETIMEDOUT'
])

let databaseClient: DatabaseClient | undefined

export function getDatabase(): DatabaseClient {
  const config = useRuntimeConfig()
  const databaseUrl = config.databaseUrl || process.env.DATABASE_URL

  if (!databaseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Database is not configured'
    })
  }

  databaseClient ??= postgres(databaseUrl, {
    connect_timeout: 15,
    idle_timeout: 20,
    max: 5,
    prepare: false
  })

  return databaseClient
}

function getDatabaseErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return ''
  }

  const candidate = error as { code?: unknown, errno?: unknown, cause?: unknown }
  const code = typeof candidate.code === 'string'
    ? candidate.code
    : typeof candidate.errno === 'string'
      ? candidate.errno
      : ''

  if (code) {
    return code
  }

  return getDatabaseErrorCode(candidate.cause)
}

export async function withDatabaseRetry<T>(
  operation: (database: DatabaseClient) => Promise<T>,
  retries = 1
): Promise<T> {
  let attempt = 0

  while (true) {
    try {
      return await operation(getDatabase())
    } catch (error: unknown) {
      const code = getDatabaseErrorCode(error)

      if (attempt >= retries || !TRANSIENT_DATABASE_ERROR_CODES.has(code)) {
        throw error
      }

      attempt += 1
      await new Promise(resolve => setTimeout(resolve, 250 * attempt))
    }
  }
}
