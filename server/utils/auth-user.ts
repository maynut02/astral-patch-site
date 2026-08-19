import { createError } from 'h3'
import postgres from 'postgres'
import type { H3Event } from 'h3'

export type AppRole = 'admin' | 'user'

export interface GoogleProfile {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

export interface AppUser {
  googleSub: string
  email: string
  name: string
  avatarUrl: string
  role: AppRole
}

type DatabaseClient = ReturnType<typeof postgres>

let databaseClient: DatabaseClient | undefined
let usersTableReady: Promise<void> | undefined

function getDatabase(): DatabaseClient {
  const config = useRuntimeConfig()
  const databaseUrl = config.databaseUrl || process.env.DATABASE_URL

  if (!databaseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'DATABASE_URL is not configured'
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

async function ensureUsersTable(database: DatabaseClient): Promise<void> {
  if (!usersTableReady) {
    usersTableReady = database`
      CREATE TABLE IF NOT EXISTS app_users (
        google_sub text PRIMARY KEY,
        email text NOT NULL,
        name text NOT NULL DEFAULT '',
        avatar_url text NOT NULL DEFAULT '',
        "role" text NOT NULL DEFAULT 'user'
          CHECK ("role" IN ('admin', 'user')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz NOT NULL DEFAULT now()
      )
    `.then(() => undefined).catch((error) => {
        usersTableReady = undefined
        throw error
      })
  }

  await usersTableReady
}

function configuredAdminEmails(): Set<string> {
  const config = useRuntimeConfig()
  const raw = config.adminGoogleEmails || process.env.NUXT_ADMIN_GOOGLE_EMAILS || ''

  return new Set(
    raw
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean)
  )
}

export async function upsertGoogleUser(profile: GoogleProfile): Promise<AppUser> {
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Google account email could not be verified'
    })
  }

  const database = getDatabase()
  await ensureUsersTable(database)

  const email = profile.email.trim().toLowerCase()
  const name = profile.name?.trim() || email
  const avatarUrl = profile.picture?.trim() || ''
  const role: AppRole = configuredAdminEmails().has(email) ? 'admin' : 'user'

  const [user] = await database<AppUser[]>`
    INSERT INTO app_users (
      google_sub,
      email,
      name,
      avatar_url,
      "role"
    )
    VALUES (
      ${profile.sub},
      ${email},
      ${name},
      ${avatarUrl},
      ${role}
    )
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      avatar_url = EXCLUDED.avatar_url,
      "role" = CASE
        WHEN app_users."role" = 'admin' OR EXCLUDED."role" = 'admin'
          THEN 'admin'
        ELSE app_users."role"
      END,
      updated_at = now(),
      last_login_at = now()
    RETURNING
      google_sub AS "googleSub",
      email,
      name,
      avatar_url AS "avatarUrl",
      "role" AS role
  `

  if (!user) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Google user could not be saved'
    })
  }

  return user
}

export async function requireAdminSession(event: H3Event) {
  const session = await requireUserSession(event)

  if (session.user.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Admin permission is required'
    })
  }

  return session
}
