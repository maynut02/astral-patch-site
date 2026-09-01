import { randomUUID } from 'node:crypto'
import type { EditorComment, EditorCommentsResponse } from '#shared/types/editor-comment'
import { createError } from 'h3'
import type { DatabaseClient } from './database'
import { getDatabase } from './database'
import { parseRequiredText, parseUuid } from './validation'
import { broadcastWsMessage } from './ws-hub'

export const EDITOR_COMMENT_PAGE_SIZE = 50
export const EDITOR_COMMENT_MAX_LENGTH = 2_000

interface EditorCommentRow extends EditorComment {}

interface EditorCommentCursorRow {
  id: string
  createdAt: string
}

function parseOptionalCommentId(value: unknown, statusMessage: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }

  return parseUuid(value, statusMessage)
}

async function findCommentCursor(
  database: DatabaseClient,
  commentId: string,
  unitId: string | null
): Promise<EditorCommentCursorRow | null> {
  const [row] = unitId
    ? await database<EditorCommentCursorRow[]>`
        SELECT
          c.id,
          c.created_at AS "createdAt"
        FROM editor_comments c
        WHERE c.id = ${commentId}
          AND c.unit_id = ${unitId}
      `
    : await database<EditorCommentCursorRow[]>`
        SELECT
          c.id,
          c.created_at AS "createdAt"
        FROM editor_comments c
        WHERE c.id = ${commentId}
      `

  return row ?? null
}

export async function getEditorComments(input: {
  itemId?: unknown
  before?: unknown
}): Promise<EditorCommentsResponse> {
  const database = getDatabase()
  const unitId = parseOptionalCommentId(input.itemId, 'Invalid comment item id')
  const beforeId = parseOptionalCommentId(input.before, 'Invalid comment cursor')
  const cursor = beforeId
    ? await findCommentCursor(database, beforeId, unitId)
    : null

  if (beforeId && !cursor) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid comment cursor'
    })
  }

  let rows: EditorCommentRow[]

  if (unitId && cursor) {
    rows = await database<EditorCommentRow[]>`
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
      WHERE c.unit_id = ${unitId}
        AND (c.created_at, c.id) < (${cursor.createdAt}, ${cursor.id})
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${EDITOR_COMMENT_PAGE_SIZE + 1}
    `
  } else if (unitId) {
    rows = await database<EditorCommentRow[]>`
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
      WHERE c.unit_id = ${unitId}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${EDITOR_COMMENT_PAGE_SIZE + 1}
    `
  } else if (cursor) {
    rows = await database<EditorCommentRow[]>`
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
      WHERE (c.created_at, c.id) < (${cursor.createdAt}, ${cursor.id})
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${EDITOR_COMMENT_PAGE_SIZE + 1}
    `
  } else {
    rows = await database<EditorCommentRow[]>`
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
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${EDITOR_COMMENT_PAGE_SIZE + 1}
    `
  }

  const hasMore = rows.length > EDITOR_COMMENT_PAGE_SIZE
  const visibleRows = hasMore ? rows.slice(0, EDITOR_COMMENT_PAGE_SIZE) : rows
  const nextCursor = hasMore ? visibleRows.at(-1)?.id ?? null : null

  return {
    comments: visibleRows.reverse(),
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

  return row ?? null
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
