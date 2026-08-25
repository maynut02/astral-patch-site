import { createError } from 'h3'
import postgres from 'postgres'

export type DatabaseClient = ReturnType<typeof postgres>

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
    connect_timeout: 10,
    idle_timeout: 20,
    max: 5,
    prepare: false
  })

  return databaseClient
}
