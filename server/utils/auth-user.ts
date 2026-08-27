import { createError } from 'h3'
import type { H3Event } from 'h3'
import { getDatabase } from './database'

export type AppRole = 'admin' | 'verified' | 'user' | 'bot'

export const BOT_GOOGLE_SUB = 'bot'
export const BOT_HANDLE = 'Bot'

export interface GoogleProfile {
  sub?: string
  email?: string
  email_verified?: boolean
}

export interface AppUser {
  googleSub: string
  email: string
  handle: string | null
  role: AppRole
}

export interface CurrentSessionUser {
  id: string
  email: string
  handle: string | null
  role: AppRole
}

export async function upsertGoogleUser(profile: GoogleProfile): Promise<AppUser> {
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Google account email could not be verified'
    })
  }

  const database = getDatabase()
  const email = profile.email.trim().toLowerCase()

  const [user] = await database<AppUser[]>`
    INSERT INTO app_users (
      google_sub,
      email,
      last_login_at
    )
    VALUES (
      ${profile.sub},
      ${email},
      now()
    )
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      updated_at = now(),
      last_login_at = now()
    RETURNING
      google_sub AS "googleSub",
      email,
      handle,
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

/**
 * Session claims can outlive a role or profile change in the database. Read the
 * current account before authorizing sensitive operations and refresh stale claims.
 */
export async function getCurrentSessionUser(event: H3Event): Promise<CurrentSessionUser | null> {
  const session = await getUserSession(event)
  const sessionUser = session.user
  const sessionUserId = sessionUser?.id

  if (!sessionUser || typeof sessionUserId !== 'string' || !sessionUserId) {
    return null
  }

  const database = getDatabase()
  const [user] = await database<AppUser[]>`
    SELECT
      google_sub AS "googleSub",
      email,
      handle,
      "role" AS role
    FROM app_users
    WHERE google_sub = ${sessionUserId}
  `

  if (!user) {
    return null
  }

  const currentUser: CurrentSessionUser = {
    id: user.googleSub,
    email: user.email,
    handle: user.handle,
    role: user.role
  }

  if (
    sessionUser.id !== currentUser.id
    || sessionUser.email !== currentUser.email
    || sessionUser.handle !== currentUser.handle
    || sessionUser.role !== currentUser.role
  ) {
    await setUserSession(event, {
      ...session,
      user: currentUser
    })
  }

  return currentUser
}

export async function requireCurrentSessionUser(event: H3Event): Promise<CurrentSessionUser> {
  const user = await getCurrentSessionUser(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication is required'
    })
  }

  return user
}

export async function requireAdminSession(event: H3Event): Promise<CurrentSessionUser> {
  const user = await requireCurrentSessionUser(event)

  if (user.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Admin permission is required'
    })
  }

  return user
}
