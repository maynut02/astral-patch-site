import { randomUUID } from 'node:crypto'
import type { Notice, NoticesResponse } from '#shared/types/notice'
import { createError } from 'h3'
import type { DatabaseClient } from './database'
import { getDatabase } from './database'
import { parseRequiredText } from './validation'

export const NOTICE_TITLE_MAX_LENGTH = 160
export const NOTICE_BODY_MAX_LENGTH = 10_000

type NoticeRow = Notice

async function findNotice(database: DatabaseClient, noticeId: string): Promise<Notice | null> {
  const [notice] = await database<NoticeRow[]>`
    SELECT
      n.id,
      n.title,
      n.body,
      NULLIF(BTRIM(author.handle), '') AS "authorHandle",
      author."role" AS "authorRole",
      n.created_at AS "createdAt"
    FROM notices n
    JOIN app_users author ON author.google_sub = n.created_by
    WHERE n.id = ${noticeId}
  `

  return notice ?? null
}

export async function getNotices(): Promise<NoticesResponse> {
  const database = getDatabase()
  const notices = await database<NoticeRow[]>`
    SELECT
      n.id,
      n.title,
      n.body,
      NULLIF(BTRIM(author.handle), '') AS "authorHandle",
      author."role" AS "authorRole",
      n.created_at AS "createdAt"
    FROM notices n
    JOIN app_users author ON author.google_sub = n.created_by
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 100
  `

  return { notices }
}

export async function createNotice(
  userId: string,
  titleValue: unknown,
  bodyValue: unknown
): Promise<Notice> {
  const database = getDatabase()
  const title = parseRequiredText(titleValue, 'Notice title', NOTICE_TITLE_MAX_LENGTH)
  const body = parseRequiredText(bodyValue, 'Notice body', NOTICE_BODY_MAX_LENGTH)
  const noticeId = randomUUID()

  await database`
    INSERT INTO notices (id, title, body, created_by)
    VALUES (${noticeId}, ${title}, ${body}, ${userId})
  `

  const notice = await findNotice(database, noticeId)

  if (!notice) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Notice could not be created'
    })
  }

  return notice
}
