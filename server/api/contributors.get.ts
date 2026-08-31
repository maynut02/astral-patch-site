import type { ContributorListItem, ContributorListResponse } from '#shared/types/contributors'
import { BOT_GOOGLE_SUB } from '../utils/auth-user'
import { getDatabase } from '../utils/database'

export default defineEventHandler(async (): Promise<ContributorListResponse> => {
  const database = getDatabase()

  const contributors = await database<ContributorListItem[]>`
    SELECT
      users.handle,
      users."role" AS role,
      count(changes.id)::int AS "translationCount",
      count(changes.id) FILTER (WHERE changes.status = 'approved')::int AS "approvedTranslationCount"
    FROM app_users users
    JOIN translation_changes changes ON changes.created_by = users.google_sub
    WHERE users.google_sub <> ${BOT_GOOGLE_SUB}
      AND users."role" <> 'bot'
      AND users.handle IS NOT NULL
    GROUP BY users.google_sub
    ORDER BY
      count(changes.id) DESC,
      count(changes.id) FILTER (WHERE changes.status = 'approved') DESC,
      lower(users.handle) ASC
  `

  return {
    contributors,
    total: contributors.length
  }
})
