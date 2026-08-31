import { createError } from 'h3'
import type {
  AdminUserEntry,
  AdminUserRoleUpdateResponse,
  AdminUsersResponse
} from '#shared/types/admin'
import { isUserRole, resolveUserRole, type UserRole } from '#shared/types/user'
import { BOT_GOOGLE_SUB } from './auth-user'
import { getDatabase } from './database'

interface AdminUserRow {
  id: string
  email: string
  handle: string | null
  role: UserRole
  createdAt: Date
  lastLoginAt: Date | null
}

const MANAGEABLE_USER_ROLES = new Set<UserRole>(['admin', 'verified', 'user'])

function toAdminUserEntry(row: AdminUserRow): AdminUserEntry {
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    role: resolveUserRole(row.role),
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null
  }
}

export async function getAdminUsers(): Promise<AdminUsersResponse> {
  const database = getDatabase()
  const rows = await database<AdminUserRow[]>`
    SELECT
      google_sub AS id,
      email,
      NULLIF(BTRIM(handle), '') AS handle,
      "role" AS role,
      created_at AS "createdAt",
      last_login_at AS "lastLoginAt"
    FROM app_users
    ORDER BY
      CASE WHEN google_sub = ${BOT_GOOGLE_SUB} THEN 1 ELSE 0 END,
      lower(COALESCE(NULLIF(BTRIM(handle), ''), email)) ASC,
      created_at ASC
  `

  return {
    users: rows.map(toAdminUserEntry),
    total: rows.length
  }
}

export async function updateAdminUserRole(
  targetUserId: string,
  actingUserId: string,
  value: unknown
): Promise<AdminUserRoleUpdateResponse> {
  if (!targetUserId) {
    throw createError({ statusCode: 400, statusMessage: 'User id is required' })
  }

  if (!isUserRole(value) || !MANAGEABLE_USER_ROLES.has(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid user role' })
  }

  if (targetUserId === actingUserId && value !== 'admin') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Your own administrator role cannot be changed'
    })
  }

  const database = getDatabase()

  return database.begin(async (transaction) => {
    const [target] = await transaction<{ role: UserRole }[]>`
      SELECT "role"
      FROM app_users
      WHERE google_sub = ${targetUserId}
      FOR UPDATE
    `

    if (!target) {
      throw createError({ statusCode: 404, statusMessage: 'User could not be found' })
    }

    if (targetUserId === BOT_GOOGLE_SUB || target.role === 'bot') {
      throw createError({
        statusCode: 400,
        statusMessage: 'The reserved bot account role cannot be changed'
      })
    }

    const [updated] = await transaction<{ id: string, role: UserRole }[]>`
      UPDATE app_users
      SET
        "role" = ${value},
        updated_at = now()
      WHERE google_sub = ${targetUserId}
      RETURNING
        google_sub AS id,
        "role" AS role
    `

    if (!updated) {
      throw createError({ statusCode: 404, statusMessage: 'User could not be found' })
    }

    return {
      id: updated.id,
      role: resolveUserRole(updated.role)
    }
  })
}
