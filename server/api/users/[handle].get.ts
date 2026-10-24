import { createError, getRouterParam } from 'h3'
import { HANDLE_PATTERN } from '#shared/types/profile'
import type { UserRole } from '#shared/types/user'
import { getDatabase } from '../../utils/database'
import { contributorCounts } from '../../utils/editor/sql'
import { listSocialLinks } from '../../utils/profile-details'

interface PublicUserRow {
  googleSub: string
  handle: string
  role: UserRole
  gameUid: string | null
  gameInviteCode: string | null
  translationCount: number
  approvedTranslationCount: number
  createdAt: Date
}

export default defineEventHandler(async (event) => {
  const handle = getRouterParam(event, 'handle')?.trim()

  if (!handle || !HANDLE_PATTERN.test(handle)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User could not be found'
    })
  }

  const database = getDatabase()

  const [user] = await database<PublicUserRow[]>`
    SELECT
      users.google_sub AS "googleSub",
      users.handle,
      users."role" AS role,
      users.game_uid AS "gameUid",
      users.game_invite_code AS "gameInviteCode",
      ${contributorCounts(database)},
      users.created_at AS "createdAt"
    FROM app_users users
    LEFT JOIN translation_changes changes ON changes.created_by = users.google_sub
    WHERE lower(users.handle) = ${handle.toLowerCase()}
    GROUP BY users.google_sub
    LIMIT 1
  `

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User could not be found'
    })
  }

  const socialLinks = await listSocialLinks(database, user.googleSub)

  return {
    handle: user.handle,
    role: user.role,
    gameUid: user.gameUid,
    gameInviteCode: user.gameInviteCode,
    socialLinks,
    translationCount: user.translationCount,
    approvedTranslationCount: user.approvedTranslationCount,
    createdAt: user.createdAt
  }
})
