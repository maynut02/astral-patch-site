import { createError } from 'h3'
import type { H3Event } from 'h3'
import { getDatabase, type DatabaseClient } from './database'

export type AppRole = 'admin' | 'user'
export type AppUserType = 'user' | 'bot'

export const BOT_GOOGLE_SUB = 'bot'
export const BOT_HANDLE = 'but'
export const BOT_NICKNAME = 'Bot'

const BOT_EMAIL = 'bot@system.local'
const BOT_WORK_MIGRATION_ID = 'assign-existing-work-to-bot-v1'

export interface GoogleProfile {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
}

export interface AppUser {
  googleSub: string
  email: string
  name: string
  handle: string | null
  nickname: string | null
  role: AppRole
  userType: AppUserType
}

let usersTableReady: Promise<void> | undefined
let botWorkMigrationReady: Promise<void> | undefined

export async function ensureUsersTable(database: DatabaseClient): Promise<void> {
  if (!usersTableReady) {
    usersTableReady = (async () => {
      await database`
        CREATE TABLE IF NOT EXISTS app_users (
          google_sub text PRIMARY KEY,
          email text NOT NULL,
          name text NOT NULL DEFAULT '',
          avatar_url text NOT NULL DEFAULT '',
          handle text,
          nickname text,
          user_type text NOT NULL DEFAULT 'user'
            CHECK (user_type IN ('user', 'bot')),
          "role" text NOT NULL DEFAULT 'user'
            CHECK ("role" IN ('admin', 'user')),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          last_login_at timestamptz NOT NULL DEFAULT now()
        )
      `
      await database`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS handle text`
      await database`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS nickname text`
      await database`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS user_type text NOT NULL DEFAULT 'user'`
      await database`UPDATE app_users SET user_type = 'user' WHERE user_type IS NULL`
      await database`ALTER TABLE app_users ALTER COLUMN user_type SET DEFAULT 'user'`
      await database`ALTER TABLE app_users ALTER COLUMN user_type SET NOT NULL`
      await database`
        DO $$
        BEGIN
          ALTER TABLE app_users
            ADD CONSTRAINT app_users_user_type_check
            CHECK (user_type IN ('user', 'bot'));
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END
        $$
      `
      await database`
        CREATE UNIQUE INDEX IF NOT EXISTS app_users_handle_unique_idx
        ON app_users (handle)
        WHERE handle IS NOT NULL
      `
      await database`
        INSERT INTO app_users (
          google_sub,
          email,
          name,
          handle,
          nickname,
          user_type,
          "role"
        )
        VALUES (
          ${BOT_GOOGLE_SUB},
          ${BOT_EMAIL},
          ${BOT_NICKNAME},
          ${BOT_HANDLE},
          ${BOT_NICKNAME},
          'bot',
          'user'
        )
        ON CONFLICT (google_sub) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          handle = EXCLUDED.handle,
          nickname = EXCLUDED.nickname,
          user_type = 'bot',
          "role" = 'user',
          updated_at = now()
      `
    })().catch((error) => {
        usersTableReady = undefined
        throw error
      })
  }

  await usersTableReady
}

export async function ensureBotWorkMigration(database: DatabaseClient = getDatabase()): Promise<void> {
  await ensureUsersTable(database)

  if (!botWorkMigrationReady) {
    botWorkMigrationReady = (async () => {
      await database`
        CREATE TABLE IF NOT EXISTS app_migrations (
          id text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `

      await database.begin(async (transaction) => {
        const [migration] = await transaction<{ id: string }[]>`
          INSERT INTO app_migrations (id)
          VALUES (${BOT_WORK_MIGRATION_ID})
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `

        if (!migration) {
          return
        }

        await transaction`
          UPDATE translation_change_groups
          SET created_by = ${BOT_GOOGLE_SUB}
          WHERE created_by IS NOT NULL
        `
        await transaction`
          UPDATE translation_changes
          SET created_by = ${BOT_GOOGLE_SUB}
          WHERE created_by IS NOT NULL
        `
        await transaction`
          UPDATE translation_changes
          SET reviewed_by = ${BOT_GOOGLE_SUB}
          WHERE reviewed_by IS NOT NULL
        `
        await transaction`
          UPDATE translations
          SET approved_by = ${BOT_GOOGLE_SUB}
          WHERE approved_by IS NOT NULL
        `
      })
    })().catch((error) => {
      botWorkMigrationReady = undefined
      throw error
    })
  }

  await botWorkMigrationReady
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
  const role: AppRole = configuredAdminEmails().has(email) ? 'admin' : 'user'

  const [user] = await database<AppUser[]>`
    INSERT INTO app_users (
      google_sub,
      email,
      name,
      "role"
    )
    VALUES (
      ${profile.sub},
      ${email},
      ${name},
      ${role}
    )
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
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
      handle,
      nickname,
      user_type AS "userType",
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

function getTextLength(value: string): number {
  return Array.from(value).length
}

function parseProfileValue(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is required`
    })
  }

  const normalized = value.trim()

  if (!normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is required`
    })
  }

  if (getTextLength(normalized) > 20) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be 20 characters or fewer`
    })
  }

  return normalized
}

export async function updateUserProfile(googleSub: string, input: { handle?: unknown, nickname?: unknown }): Promise<AppUser> {
  const handle = parseProfileValue(input.handle, 'Handle')
  const nickname = parseProfileValue(input.nickname, 'Nickname')

  if (!/^[A-Za-z0-9]+$/.test(handle)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Handle may contain only letters and numbers'
    })
  }

  const database = getDatabase()
  await ensureUsersTable(database)

  try {
    const [user] = await database<AppUser[]>`
      UPDATE app_users
      SET
        handle = ${handle},
        nickname = ${nickname},
        updated_at = now()
      WHERE google_sub = ${googleSub}
      RETURNING
        google_sub AS "googleSub",
        email,
        name,
        handle,
        nickname,
        user_type AS "userType",
        "role" AS role
    `

    if (!user) {
      throw createError({
        statusCode: 404,
        statusMessage: 'User could not be found'
      })
    }

    return user
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Handle is already in use'
      })
    }

    throw error
  }
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
