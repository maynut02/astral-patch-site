import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { EditorDictionaryEntriesResponse, EditorDictionaryEntry, GlossaryMetadata } from '#shared/types/editor-dictionary'
import { emptyGlossaryMetadata } from '../../../shared/utils/glossary'
import type { UserRole } from '#shared/types/user'
import { getDatabase, type DatabaseClient } from '../database'
import { requireDictionary, type EditorDictionaryViewer } from '../editor-dictionary'
import { containsLikePattern, getFirstQueryValue, parseOptionalText, parsePage as parseValidatedPage, parseRequiredText } from '../validation'

export const EDITOR_DICTIONARY_PAGE_SIZE = 50

export interface DictionaryEntryRow {
  metadata: GlossaryMetadata
  revision: number
  id: string
  dictionaryId: string
  sourceText: string
  translation: string
  note: string
  createdBy: string
  creatorRole: UserRole
  creatorHandle: string | null
  createdAt: Date
  updatedAt: Date
}

function getSearchValue(value: unknown): string {
  return getFirstQueryValue(value).trim()
}

export function toEntry(row: DictionaryEntryRow): EditorDictionaryEntry {
  return { ...row, metadata: { ...emptyGlossaryMetadata(), ...row.metadata }, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}

export function entryFields(database: DatabaseClient) {
  return database`
    e.id, e.dictionary_id AS "dictionaryId", e.source_text AS "sourceText", e.translation,
    e.note, e.metadata, e.revision, e.created_by AS "createdBy", creator."role" AS "creatorRole",
    NULLIF(BTRIM(creator.handle), '') AS "creatorHandle",
    e.created_at AS "createdAt", e.updated_at AS "updatedAt"
  `
}

export async function getEditorDictionaryEntries(
  viewer: EditorDictionaryViewer,
  dictionaryId: string,
  input: { page?: unknown, search?: unknown, kind?: unknown, archived?: unknown }
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
  const kind = getFirstQueryValue(input.kind)
  const archived = getFirstQueryValue(input.archived) === 'true'
  if (kind && kind !== 'term' && kind !== 'voice') throw createError({ statusCode: 400, statusMessage: 'Invalid entry kind' })
  const where = database`
    e.dictionary_id = ${dictionaryId}
    AND COALESCE((e.metadata->>'archived')::boolean, false) = ${archived}
    AND (NOT ${Boolean(kind)} OR COALESCE(e.metadata->>'kind', 'term') = ${kind})
    AND (
      NOT ${Boolean(search)}
      OR e.source_text ILIKE ${pattern} ESCAPE '\\'
      OR e.translation ILIKE ${pattern} ESCAPE '\\'
      OR e.note ILIKE ${pattern} ESCAPE '\\'
      OR concat_ws(' ', e.metadata->>'japanese', e.metadata->>'chineseSimplified', e.metadata->>'chineseTraditional',
        e.metadata->>'allowed', e.metadata->>'historical', e.metadata->>'discouraged', e.metadata->>'speechStyle') ILIKE ${pattern} ESCAPE '\\'
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
        ${entryFields(database)}
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

export async function createEditorDictionaryEntry(
  viewer: EditorDictionaryViewer,
  dictionaryId: string,
  input: { sourceText?: unknown, translation?: unknown, note?: unknown }
): Promise<EditorDictionaryEntry> {
  const database = getDatabase()
  const dictionary = await requireDictionary(database, dictionaryId, viewer, true)
  if (dictionary.isTeam) throw createError({ statusCode: 403, statusMessage: 'Team entries must be proposed and reviewed' })
  const sourceText = parseRequiredText(input.sourceText, 'Source text', 500)
  const translation = parseRequiredText(input.translation, 'Translation', 500)
  const note = parseOptionalText(input.note, 'Note', 1000)
  const id = randomUUID()

  const [row] = await database<DictionaryEntryRow[]>`
    WITH saved AS (
      INSERT INTO editor_dictionary_entries (id, dictionary_id, source_text, translation, note, created_by)
      VALUES (${id}, ${dictionaryId}, ${sourceText}, ${translation}, ${note}, ${viewer.id})
      RETURNING *
    )
    SELECT ${entryFields(database)}
    FROM saved e
    JOIN app_users creator ON creator.google_sub = e.created_by
  `
  const entry = row ? toEntry(row) : null

  if (!entry) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Dictionary entry could not be created'
    })
  }

  return entry
}

export async function getEditorDictionaryEntry(viewer: EditorDictionaryViewer, dictionaryId: string, entryId: string): Promise<EditorDictionaryEntry> {
  const database = getDatabase()
  await requireDictionary(database, dictionaryId, viewer)
  const [row] = await database<DictionaryEntryRow[]>`SELECT ${entryFields(database)} FROM editor_dictionary_entries e
    JOIN app_users creator ON creator.google_sub = e.created_by WHERE e.id = ${entryId} AND e.dictionary_id = ${dictionaryId}`
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Dictionary entry not found' })
  return toEntry(row)
}
