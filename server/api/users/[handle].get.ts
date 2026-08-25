import { createError, getRouterParam } from 'h3'
import { getDatabase } from '../../utils/database'
import { ensureUsersTable, type AppRole } from '../../utils/auth-user'
import { HANDLE_PATTERN } from '../../utils/validation'

interface PublicUser {
  handle: string
  role: AppRole
  createdAt: Date
}

export default defineEventHandler(async (event) => {
  const handle = getRouterParam(event, 'handle')?.trim()

  if (!handle || handle.startsWith('@') || !HANDLE_PATTERN.test(handle)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User could not be found'
    })
  }

  const database = getDatabase()
  await ensureUsersTable(database)

  const [user] = await database<PublicUser[]>`
    SELECT
      handle,
      "role" AS role,
      created_at AS "createdAt"
    FROM app_users
    WHERE lower(handle) = ${handle.toLowerCase()}
    LIMIT 1
  `

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User could not be found'
    })
  }

  return user
})
