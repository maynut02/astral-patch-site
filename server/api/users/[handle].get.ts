import { createError, getRouterParam } from 'h3'
import type { UserSocialLink } from '#shared/types/profile'
import { getDatabase } from '../../utils/database'
import type { AppRole } from '../../utils/auth-user'
import { HANDLE_PATTERN } from '../../utils/validation'

interface PublicUserRow {
  googleSub: string
  handle: string
  role: AppRole
  gameUid: string | null
  gameInviteCode: string | null
  translationCount: number
  approvedTranslationCount: number
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

  const [user] = await database<PublicUserRow[]>`
    SELECT
      users.google_sub AS "googleSub",
      users.handle,
      users."role" AS role,
      users.game_uid AS "gameUid",
      users.game_invite_code AS "gameInviteCode",
      count(changes.id)::int AS "translationCount",
      count(changes.id) FILTER (WHERE changes.status = 'approved')::int AS "approvedTranslationCount",
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

  const socialLinks = await database<UserSocialLink[]>`
    SELECT id, label, url
    FROM app_user_social_links
    WHERE user_id = ${user.googleSub}
    ORDER BY sort_order ASC, created_at ASC
  `

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