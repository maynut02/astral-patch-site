import { randomUUID } from 'node:crypto'
import {
  EDITOR_COMMENT_MAX_LENGTH,
  type EditorComment,
  type EditorCommentsResponse
} from '#shared/types/editor-comment'
import { createError } from 'h3'
import type { DatabaseClient } from './database'
import { getDatabase } from './database'
import { parseRequiredText, parseUuid } from './validation'
import { broadcastWsMessage } from './ws-hub'

export const EDITOR_COMMENT_PAGE_SIZE = 50

type EditorCommentRow = Omit<EditorComment, 'createdAt'> & { createdAt: Date }

function toEditorComment(row: EditorCommentRow): EditorComment {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

function parseOptionalCommentId(value: unknown, statusMessage: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }

  return parseUuid(value, statusMessage)
}

export async function getEditorComments(input: {
  itemId?: unknown
  before?: unknown
}): Promise<EditorCommentsResponse> {
  const database = getDatabase()
  const unitId = parseOptionalCommentId(input.itemId, 'Invalid comment item id')
  const beforeId = parseOptionalCommentId(input.before, 'Invalid comment cursor')
  const page = await database<(EditorCommentRow & { cursorValid: boolean })[]>`
    WITH cursor AS (
      SELECT c.id, c.created_at
      FROM editor_comments c
      WHERE c.id = ${beforeId}::uuid
        AND (${unitId === null} OR c.unit_id = ${unitId}::uuid)
    )
    SELECT validity."cursorValid", comments.*
    FROM (
      SELECT ${beforeId === null} OR EXISTS (SELECT 1 FROM cursor) AS "cursorValid"
    ) validity
    LEFT JOIN LATERAL (
      SELECT
        c.id,
        c.unit_id AS "unitId",
        concat(tu.namespace, '_', tu.unit_key) AS "itemKey",
        NULLIF(BTRIM(author.handle), '') AS "authorHandle",
        author."role" AS "authorRole",
        c.body,
        c.created_at AS "createdAt"
      FROM editor_comments c
      JOIN translation_units tu ON tu.id = c.unit_id
      JOIN app_users author ON author.google_sub = c.created_by
      WHERE (${unitId === null} OR c.unit_id = ${unitId}::uuid)
        AND (${beforeId === null} OR (c.created_at, c.id) < (
          SELECT created_at, id FROM cursor
        ))
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${EDITOR_COMMENT_PAGE_SIZE + 1}
    ) comments ON validity."cursorValid"
    ORDER BY comments."createdAt" DESC, comments.id DESC
  `

  if (beforeId && !page[0]?.cursorValid) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid comment cursor' })
  }

  const rows = page.filter(row => row.id).map(({ cursorValid: _cursorValid, ...row }) => row)

  const hasMore = rows.length > EDITOR_COMMENT_PAGE_SIZE
  const visibleRows = hasMore ? rows.slice(0, EDITOR_COMMENT_PAGE_SIZE) : rows
  const nextCursor = hasMore ? visibleRows.at(-1)?.id ?? null : null

  return {
    comments: visibleRows.reverse().map(toEditorComment),
    nextCursor
  }
}

async function findEditorComment(database: DatabaseClient, commentId: string): Promise<EditorComment | null> {
  const [row] = await database<EditorCommentRow[]>`
    SELECT
      c.id,
      c.unit_id AS "unitId",
      concat(tu.namespace, '_', tu.unit_key) AS "itemKey",
      NULLIF(BTRIM(author.handle), '') AS "authorHandle",
      author."role" AS "authorRole",
      c.body,
      c.created_at AS "createdAt"
    FROM editor_comments c
    JOIN translation_units tu ON tu.id = c.unit_id
    JOIN app_users author ON author.google_sub = c.created_by
    WHERE c.id = ${commentId}
  `

  return row ? toEditorComment(row) : null
}

export async function createEditorComment(
  unitId: string,
  userId: string,
  bodyValue: unknown
): Promise<EditorComment> {
  const database = getDatabase()
  const body = parseRequiredText(bodyValue, 'Comment body', EDITOR_COMMENT_MAX_LENGTH)
  const [unit] = await database<{ id: string }[]>`
    SELECT id
    FROM translation_units
    WHERE id = ${unitId}
  `

  if (!unit) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Translation item could not be found'
    })
  }

  const commentId = randomUUID()
  await database`
    INSERT INTO editor_comments (id, unit_id, created_by, body)
    VALUES (${commentId}, ${unitId}, ${userId}, ${body})
  `

  const comment = await findEditorComment(database, commentId)

  if (!comment) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Comment could not be created'
    })
  }

  broadcastWsMessage({
    type: 'EDITOR_COMMENT_CREATED',
    comment
  }, 'editor:comment')

  return comment
}
