import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { DatabaseClient } from './database'
import { getDatabase } from './database'
import type {
  EditorDictionary,
  EditorDictionaryEntriesResponse,
  EditorDictionaryEntry,
  EditorDictionaryVisibility,
  EditorDictionariesResponse
} from '../../shared/types/editor-dictionary'
import { resolveEditorRole } from '../../shared/types/editor'
import type { UserRole } from '../../shared/types/user'
import {
  containsLikePattern,
  getFirstQueryValue,
  parseOptionalText,
  parsePage as parseValidatedPage,
  parseRequiredText,
  parseUuid
} from './validation'

export const EDITOR_DICTIONARY_PAGE_SIZE = 50

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
  id: string
  ownerId: string
  ownerRole: UserRole
  ownerHandle: string | null
  name: string
  description: string
  visibility: EditorDictionaryVisibility
  entryCount: number
  createdAt: string
  updatedAt: string
}

interface DictionaryEntryRow {
  id: string
  dictionaryId: string
  sourceText: string
  translation: string
  note: string
  createdBy: string
  creatorRole: UserRole
  creatorHandle: string | null
  createdAt: string
  updatedAt: string
}

function parseVisibility(value: unknown, fallback: EditorDictionaryVisibility = 'private'): EditorDictionaryVisibility {
  if (value === undefined || value === null || value === '') {
    return fallback
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

export function parseEditorDictionaryEntryId(value: unknown): string {
  return parseEditorDictionaryId(value)
}

function getSearchValue(value: unknown): string {
  return getFirstQueryValue(value).trim()
}

function toDictionary(row: DictionaryRow, viewer: EditorDictionaryViewer): EditorDictionary {
  return {
    ...row,
    canEdit: viewer.role === 'admin' || row.ownerId === viewer.id
  }
}

function toEntry(row: DictionaryEntryRow): EditorDictionaryEntry {
  return row
}

async function findDictionary(
  database: DatabaseClient,
  dictionaryId: string,
  viewer: EditorDictionaryViewer
): Promise<EditorDictionary | null> {
  const [row] = await database<DictionaryRow[]>`
    SELECT
      d.id,
      d.owner_id AS "ownerId",
      owner."role" AS "ownerRole",
      NULLIF(BTRIM(owner.handle), '') AS "ownerHandle",
      d.name,
      d.description,
      d.visibility,
      count(entry.id)::int AS "entryCount",
      d.created_at AS "createdAt",
      d.updated_at AS "updatedAt"
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

async function requireDictionary(
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
      d.id,
      d.owner_id AS "ownerId",
      owner."role" AS "ownerRole",
      NULLIF(BTRIM(owner.handle), '') AS "ownerHandle",
      d.name,
      d.description,
      d.visibility,
      count(entry.id)::int AS "entryCount",
      d.created_at AS "createdAt",
      d.updated_at AS "updatedAt"
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
  input: { name?: unknown, description?: unknown, visibility?: unknown }
): Promise<EditorDictionary> {
  const database = getDatabase()
  const name = parseRequiredText(input.name, 'Dictionary name', 100)
  const description = parseOptionalText(input.description, 'Dictionary description', 500)
  const visibility = parseVisibility(input.visibility)
  const id = randomUUID()

  await database`
    INSERT INTO editor_dictionaries (id, owner_id, name, description, visibility)
    VALUES (${id}, ${viewer.id}, ${name}, ${description}, ${visibility})
  `

  return requireDictionary(database, id, viewer)
}

export async function updateEditorDictionary(
  viewer: EditorDictionaryViewer,
  dictionaryId: string,
  input: { name?: unknown, description?: unknown, visibility?: unknown }
): Promise<EditorDictionary> {
  const database = getDatabase()
  const current = await requireDictionary(database, dictionaryId, viewer, true)
  const name = input.name === undefined ? current.name : parseRequiredText(input.name, 'Dictionary name', 100)
  const description = input.description === undefined
    ? current.description
    : parseOptionalText(input.description, 'Dictionary description', 500)
  const visibility = parseVisibility(input.visibility, current.visibility)

  await database`
    UPDATE editor_dictionaries
    SET
      name = ${name},
      description = ${description},
      visibility = ${visibility},
      updated_at = now()
    WHERE id = ${dictionaryId}
  `

  return requireDictionary(database, dictionaryId, viewer)
}

export async function deleteEditorDictionary(viewer: EditorDictionaryViewer, dictionaryId: string): Promise<void> {
  const database = getDatabase()
  await requireDictionary(database, dictionaryId, viewer, true)
  await database`DELETE FROM editor_dictionaries WHERE id = ${dictionaryId}`
}

export async function getEditorDictionaryEntries(
  viewer: EditorDictionaryViewer,
  dictionaryId: string,
  input: { page?: unknown, search?: unknown }
): Promise<EditorDictionaryEntriesResponse> {
  const database = getDatabase()
  await requireDictionary(database, dictionaryId, viewer)
  const page = parseValidatedPage(input.page, 'Invalid page')
  const search = getSearchValue(input.search)

  if (Array.from(search).length > 200) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Search value is too long'
    })
  }

  const pattern = containsLikePattern(search)
  const where = database`
    e.dictionary_id = ${dictionaryId}
    AND (
      NOT ${Boolean(search)}
      OR e.source_text ILIKE ${pattern} ESCAPE '\\'
      OR e.translation ILIKE ${pattern} ESCAPE '\\'
      OR e.note ILIKE ${pattern} ESCAPE '\\'
    )
  `
  const offset = (page - 1) * EDITOR_DICTIONARY_PAGE_SIZE
  const [countRows, rows] = await Promise.all([
    database<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM editor_dictionary_entries e
      WHERE ${where}
    `,
    database<DictionaryEntryRow[]>`
      SELECT
        e.id,
        e.dictionary_id AS "dictionaryId",
        e.source_text AS "sourceText",
        e.translation,
        e.note,
        e.created_by AS "createdBy",
        creator."role" AS "creatorRole",
        NULLIF(BTRIM(creator.handle), '') AS "creatorHandle",
        e.created_at AS "createdAt",
        e.updated_at AS "updatedAt"
      FROM editor_dictionary_entries e
      JOIN app_users creator ON creator.google_sub = e.created_by
      WHERE ${where}
      ORDER BY e.source_text ASC, e.id ASC
      LIMIT ${EDITOR_DICTIONARY_PAGE_SIZE}
      OFFSET ${offset}
    `
  ])

  const total = Number(countRows[0]?.total || 0)

  return {
    entries: rows.map(toEntry),
    total,
    page,
    pageSize: EDITOR_DICTIONARY_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / EDITOR_DICTIONARY_PAGE_SIZE))
  }
}

async function findEntry(database: DatabaseClient, dictionaryId: string, entryId: string): Promise<EditorDictionaryEntry | null> {
  const [row] = await database<DictionaryEntryRow[]>`
    SELECT
      e.id,
      e.dictionary_id AS "dictionaryId",
      e.source_text AS "sourceText",
      e.translation,
      e.note,
      e.created_by AS "createdBy",
      creator."role" AS "creatorRole",
      NULLIF(BTRIM(creator.handle), '') AS "creatorHandle",
      e.created_at AS "createdAt",
      e.updated_at AS "updatedAt"
    FROM editor_dictionary_entries e
    JOIN app_users creator ON creator.google_sub = e.created_by
    WHERE e.dictionary_id = ${dictionaryId}
      AND e.id = ${entryId}
  `

  return row ? toEntry(row) : null
}

export async function createEditorDictionaryEntry(
  viewer: EditorDictionaryViewer,
  dictionaryId: string,
  input: { sourceText?: unknown, translation?: unknown, note?: unknown }
): Promise<EditorDictionaryEntry> {
  const database = getDatabase()
  await requireDictionary(database, dictionaryId, viewer, true)
  const sourceText = parseRequiredText(input.sourceText, 'Source text', 500)
  const translation = parseRequiredText(input.translation, 'Translation', 500)
  const note = parseOptionalText(input.note, 'Note', 1000)
  const id = randomUUID()

  await database`
    INSERT INTO editor_dictionary_entries (
      id,
      dictionary_id,
      source_text,
      translation,
      note,
      created_by
    )
    VALUES (${id}, ${dictionaryId}, ${sourceText}, ${translation}, ${note}, ${viewer.id})
  `

  const entry = await findEntry(database, dictionaryId, id)

  if (!entry) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Dictionary entry could not be created'
    })
  }

  return entry
}

export async function updateEditorDictionaryEntry(
  viewer: EditorDictionaryViewer,
  dictionaryId: string,
  entryId: string,
  input: { sourceText?: unknown, translation?: unknown, note?: unknown }
): Promise<EditorDictionaryEntry> {
  const database = getDatabase()
  await requireDictionary(database, dictionaryId, viewer, true)
  const current = await findEntry(database, dictionaryId, entryId)

  if (!current) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Dictionary entry not found'
    })
  }

  const sourceText = input.sourceText === undefined
    ? current.sourceText
    : parseRequiredText(input.sourceText, 'Source text', 500)
  const translation = input.translation === undefined
    ? current.translation
    : parseRequiredText(input.translation, 'Translation', 500)
  const note = input.note === undefined
    ? current.note
    : parseOptionalText(input.note, 'Note', 1000)

  await database`
    UPDATE editor_dictionary_entries
    SET
      source_text = ${sourceText},
      translation = ${translation},
      note = ${note},
      updated_at = now()
    WHERE dictionary_id = ${dictionaryId}
      AND id = ${entryId}
  `

  const entry = await findEntry(database, dictionaryId, entryId)

  if (!entry) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Dictionary entry could not be updated'
    })
  }

  return entry
}

export async function deleteEditorDictionaryEntry(
  viewer: EditorDictionaryViewer,
  dictionaryId: string,
  entryId: string
): Promise<void> {
  const database = getDatabase()
  await requireDictionary(database, dictionaryId, viewer, true)
  const result = await database`
    DELETE FROM editor_dictionary_entries
    WHERE dictionary_id = ${dictionaryId}
      AND id = ${entryId}
  `

  if (result.count === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Dictionary entry not found'
    })
  }
}
