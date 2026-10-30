import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { DatabaseClient } from './database'
import { getDatabase } from './database'
import type {
  EditorDictionary,
  EditorDictionaryVisibility,
  EditorDictionariesResponse
} from '../../shared/types/editor-dictionary'
import { resolveEditorRole } from '../../shared/types/editor'
import type { UserRole } from '../../shared/types/user'
import { isReviewerRole } from '../../shared/types/user'
import {
  parseOptionalText,
  parseRequiredText,
  parseUuid
} from './validation'

export interface EditorDictionaryViewer {
  id: string
  role: UserRole
}

export function getEditorDictionaryViewer(user: { id?: unknown, role?: unknown } | null | undefined): EditorDictionaryViewer {
  return {
    id: typeof user?.id === 'string' ? user.id : '',
    role: resolveEditorRole(user)
  }
}

interface DictionaryRow {
  isTeam: boolean
  id: string
  ownerId: string
  ownerRole: UserRole
  ownerHandle: string | null
  name: string
  description: string
  visibility: EditorDictionaryVisibility
  entryCount: number
  createdAt: Date
  updatedAt: Date
}

function parseVisibility(value: unknown): EditorDictionaryVisibility {
  if (value === undefined || value === null || value === '') {
    return 'private'
  }

  if (value !== 'public' && value !== 'private') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid dictionary visibility'
    })
  }

  return value
}

export function parseEditorDictionaryId(value: unknown): string {
  return parseUuid(value, 'Invalid dictionary id')
}

function toDictionary(row: DictionaryRow, viewer: EditorDictionaryViewer): EditorDictionary {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canEdit: row.isTeam ? isReviewerRole(viewer.role) : viewer.role === 'admin' || row.ownerId === viewer.id
  }
}

function dictionaryFields(database: DatabaseClient) {
  return database`
    d.id, d.is_team AS "isTeam", d.owner_id AS "ownerId", owner."role" AS "ownerRole",
    NULLIF(BTRIM(owner.handle), '') AS "ownerHandle", d.name, d.description, d.visibility,
    count(entry.id)::int AS "entryCount", d.created_at AS "createdAt", d.updated_at AS "updatedAt"
  `
}

async function findDictionary(
  database: DatabaseClient,
  dictionaryId: string,
  viewer: EditorDictionaryViewer
): Promise<EditorDictionary | null> {
  const [row] = await database<DictionaryRow[]>`
    SELECT
      ${dictionaryFields(database)}
    FROM editor_dictionaries d
    JOIN app_users owner ON owner.google_sub = d.owner_id
    LEFT JOIN editor_dictionary_entries entry ON entry.dictionary_id = d.id
    WHERE d.id = ${dictionaryId}
      AND (
        ${viewer.role === 'admin'}
        OR d.visibility = 'public'
        OR d.owner_id = ${viewer.id}
      )
    GROUP BY d.id, owner."role", owner.handle
  `

  return row ? toDictionary(row, viewer) : null
}

export async function requireDictionary(
  database: DatabaseClient,
  dictionaryId: string,
  viewer: EditorDictionaryViewer,
  editable = false
): Promise<EditorDictionary> {
  const dictionary = await findDictionary(database, dictionaryId, viewer)

  if (!dictionary) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Dictionary not found'
    })
  }

  if (editable && !dictionary.canEdit) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Dictionary can only be edited by its owner'
    })
  }

  return dictionary
}

export async function getEditorDictionaries(viewer: EditorDictionaryViewer): Promise<EditorDictionariesResponse> {
  const database = getDatabase()

  const rows = await database<DictionaryRow[]>`
    SELECT
      ${dictionaryFields(database)}
    FROM editor_dictionaries d
    JOIN app_users owner ON owner.google_sub = d.owner_id
    LEFT JOIN editor_dictionary_entries entry ON entry.dictionary_id = d.id
    WHERE ${viewer.role === 'admin'}
      OR d.visibility = 'public'
      OR d.owner_id = ${viewer.id}
    GROUP BY d.id, owner."role", owner.handle
    ORDER BY d.updated_at DESC, d.id DESC
  `

  return {
    dictionaries: rows.map(row => toDictionary(row, viewer))
  }
}

export async function createEditorDictionary(
  viewer: EditorDictionaryViewer,
  input: { name?: unknown, description?: unknown, visibility?: unknown, isTeam?: unknown }
): Promise<EditorDictionary> {
  const database = getDatabase()
  const name = parseRequiredText(input.name, 'Dictionary name', 100)
  const description = parseOptionalText(input.description, 'Dictionary description', 500)
  const visibility = parseVisibility(input.visibility)
  if (input.isTeam !== undefined && typeof input.isTeam !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid team dictionary flag' })
  }
  const isTeam = input.isTeam === true
  if (isTeam && (!isReviewerRole(viewer.role) || visibility !== 'public')) {
    throw createError({ statusCode: 403, statusMessage: 'Reviewers can create public team dictionaries only' })
  }
  const id = randomUUID()

  const [row] = await database<DictionaryRow[]>`
    WITH saved AS (
      INSERT INTO editor_dictionaries (id, owner_id, name, description, visibility, is_team)
      VALUES (${id}, ${viewer.id}, ${name}, ${description}, ${visibility}, ${isTeam})
      RETURNING *
    )
    SELECT ${dictionaryFields(database)}
    FROM saved d
    JOIN app_users owner ON owner.google_sub = d.owner_id
    LEFT JOIN editor_dictionary_entries entry ON entry.dictionary_id = d.id
    GROUP BY d.id, d.is_team, d.owner_id, d.name, d.description, d.visibility, d.created_at, d.updated_at, owner."role", owner.handle
  `
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Dictionary not found' })
  return toDictionary(row, viewer)
}
