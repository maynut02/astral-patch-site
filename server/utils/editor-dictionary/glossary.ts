import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { GlossaryMetadata, GlossaryProposal, GlossaryProposalsResponse, GlossaryDecision, GlossaryChangeKind, GlossaryContextResponse } from '../../../shared/types/editor-dictionary'
import { isReviewerRole } from '../../../shared/types/user'
import { emptyGlossaryMetadata, glossaryNextStatus, glossarySourceMatches } from '../../../shared/utils/glossary'
import { getDatabase, type DatabaseClient } from '../database'
import { requireDictionary, type EditorDictionaryViewer } from '../editor-dictionary'
import { entryFields, toEntry, type DictionaryEntryRow } from './entries'
import { getFirstQueryValue, parseOptionalText, parseRequiredText, parseUuid, parsePage } from '../validation'

export function parseGlossaryMetadata(value: unknown): GlossaryMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createError({ statusCode: 400, statusMessage: 'Glossary metadata is required' })
  const input = value as Record<string, unknown>
  const result = emptyGlossaryMetadata()
  if (input.archived !== undefined && typeof input.archived !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Invalid archive flag' })
  result.archived = input.archived === true
  if (input.kind !== 'term' && input.kind !== 'voice') throw createError({ statusCode: 400, statusMessage: 'Invalid glossary kind' })
  result.kind = input.kind
  const fields = ['japanese', 'chineseSimplified', 'chineseTraditional', 'target', 'semanticNote', 'evidenceKey', 'speechStyle', 'selfAddress', 'otherAddress', 'endings', 'exceptions', 'exampleSource', 'exampleTranslation'] as const
  for (const field of fields) result[field] = parseOptionalText(input[field], field, field === 'japanese' || field.startsWith('chinese') ? 200 : 1000)
  for (const field of ['allowed', 'historical', 'discouraged'] as const) {
    const values = input[field] ?? []
    if (!Array.isArray(values) || values.length > 10) throw createError({ statusCode: 400, statusMessage: 'Invalid glossary variants' })
    result[field] = [...new Set(values.map(text => parseRequiredText(text, field, 200)))]
  }
  if (input.scope !== undefined && !['project', 'file', 'entry', 'character'].includes(String(input.scope))) throw createError({ statusCode: 400, statusMessage: 'Invalid glossary scope' })
  result.scope = (input.scope ?? 'project') as GlossaryMetadata['scope']
  if (result.scope !== 'project' && !result.target) throw createError({ statusCode: 400, statusMessage: 'Scope target is required' })
  if (result.scope === 'project') result.target = ''
  if (input.semanticReview !== undefined && !['unrecorded', 'recorded', 'unresolved'].includes(String(input.semanticReview))) throw createError({ statusCode: 400, statusMessage: 'Invalid semantic review' })
  result.semanticReview = (input.semanticReview ?? 'unrecorded') as GlossaryMetadata['semanticReview']
  if (result.semanticReview === 'recorded' && !result.semanticNote) throw createError({ statusCode: 400, statusMessage: 'Semantic review note is required' })
  if (result.kind === 'term' && !result.japanese && !result.chineseSimplified && !result.chineseTraditional) throw createError({ statusCode: 400, statusMessage: 'Japanese or Chinese term is required' })
  if (result.kind === 'voice' && (!result.speechStyle || !result.exampleTranslation)) throw createError({ statusCode: 400, statusMessage: 'Voice style and representative line are required' })
  return result
}

type ProposalRow = Omit<GlossaryProposal, 'createdAt' | 'updatedAt'> & { createdAt: Date, updatedAt: Date }
const toProposal = (row: ProposalRow): GlossaryProposal => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })
const proposalFields = (sql: DatabaseClient) => sql`
  p.id, p.dictionary_id AS "dictionaryId", p.entry_id AS "entryId", p.result_entry_id AS "resultEntryId", p.base_revision AS "baseRevision",
  p.source_text AS "sourceText", p.translation, p.note, p.metadata, p.change_kind AS "changeKind", p.status,
  p.created_by AS "createdBy", creator.handle AS "creatorHandle", p.created_at AS "createdAt", p.updated_at AS "updatedAt", p.history
`

async function requireTeam(sql: DatabaseClient, id: string, viewer: EditorDictionaryViewer) {
  const dictionary = await requireDictionary(sql, id, viewer)
  if (!dictionary.isTeam) throw createError({ statusCode: 400, statusMessage: 'A team dictionary is required' })
  return dictionary
}

export async function getGlossaryProposals(viewer: EditorDictionaryViewer, dictionaryId: string, input: { status?: unknown, page?: unknown, entryId?: unknown }): Promise<GlossaryProposalsResponse> {
  const sql = getDatabase()
  await requireTeam(sql, dictionaryId, viewer)
  const status = getFirstQueryValue(input.status)
  if (status && !['pending', 'held', 'approved', 'rejected', 'withdrawn'].includes(status)) throw createError({ statusCode: 400, statusMessage: 'Invalid proposal status' })
  const entryId = input.entryId ? parseUuid(input.entryId, 'Invalid entry id') : null
  const page = parsePage(input.page, 'Invalid page')
  const where = sql`p.dictionary_id = ${dictionaryId} AND (NOT ${Boolean(status)} OR p.status = ${status})
    AND (${entryId}::uuid IS NULL OR p.entry_id = ${entryId} OR p.result_entry_id = ${entryId})`
  const [counts, rows] = await Promise.all([
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM editor_dictionary_proposals p WHERE ${where}`,
    sql<ProposalRow[]>`SELECT ${proposalFields(sql)} FROM editor_dictionary_proposals p JOIN app_users creator ON creator.google_sub = p.created_by
      WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`
  ])
  const total = counts[0]?.total ?? 0
  return { proposals: rows.map(toProposal), page, total, totalPages: Math.max(1, Math.ceil(total / 50)) }
}

export async function proposeGlossaryEntry(viewer: EditorDictionaryViewer, dictionaryId: string, input: Record<string, unknown>, sql = getDatabase()): Promise<GlossaryProposal> {
  await requireTeam(sql, dictionaryId, viewer)
  const requestId = input.requestId ? parseUuid(input.requestId, 'Invalid request id') : randomUUID()
  const [previous] = await sql<ProposalRow[]>`SELECT ${proposalFields(sql)} FROM editor_dictionary_proposals p JOIN app_users creator ON creator.google_sub = p.created_by
    WHERE p.dictionary_id = ${dictionaryId} AND p.created_by = ${viewer.id} AND p.request_id = ${requestId}`
  if (previous) return toProposal(previous)
  const metadata = parseGlossaryMetadata(input.metadata)
  const translation = parseRequiredText(input.translation, 'Korean translation or character name', 200)
  const note = parseRequiredText(input.note, 'Meaning and decision reason', 1000)
  const sourceText = metadata.kind === 'voice' ? translation : metadata.japanese || metadata.chineseSimplified || metadata.chineseTraditional
  const entryId = input.entryId ? parseUuid(input.entryId, 'Invalid entry id') : null
  const baseRevision = entryId ? Number(input.baseRevision) : 0
  if (entryId && (!Number.isSafeInteger(baseRevision) || baseRevision < 1)) throw createError({ statusCode: 400, statusMessage: 'Base revision is required' })
  if (entryId) {
    const [entry] = await sql<{ revision: number }[]>`SELECT revision FROM editor_dictionary_entries WHERE id = ${entryId} AND dictionary_id = ${dictionaryId}`
    if (!entry) throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
    if (entry.revision !== baseRevision) throw createError({ statusCode: 409, statusMessage: 'Glossary revision changed' })
  }
  const kinds: GlossaryChangeKind[] = ['new', 'terminology', 'meaning', 'style']
  if (!kinds.includes(input.changeKind as GlossaryChangeKind)) throw createError({ statusCode: 400, statusMessage: 'Invalid change kind' })
  const changeKind = input.changeKind as GlossaryChangeKind
  if (metadata.scope === 'file' || metadata.scope === 'entry') {
    const [target] = await sql`SELECT id FROM translation_units WHERE CASE WHEN ${metadata.scope === 'file'} THEN namespace = ${metadata.target}
      ELSE namespace || '_' || unit_key = ${metadata.target} END LIMIT 1`
    if (!target) throw createError({ statusCode: 400, statusMessage: 'Scope target does not exist' })
  }
  const [row] = await sql<ProposalRow[]>`
    WITH saved AS (
      INSERT INTO editor_dictionary_proposals (id, dictionary_id, entry_id, base_revision, source_text, translation, note, metadata, change_kind, created_by, request_id)
      VALUES (${randomUUID()}, ${dictionaryId}, ${entryId}, ${baseRevision}, ${sourceText}, ${translation}, ${note}, ${sql.json({ ...metadata })}, ${changeKind}, ${viewer.id}, ${requestId})
      ON CONFLICT (created_by, request_id) DO UPDATE SET request_id = EXCLUDED.request_id
        WHERE editor_dictionary_proposals.dictionary_id = EXCLUDED.dictionary_id RETURNING *
    ) SELECT ${proposalFields(sql)} FROM saved p JOIN app_users creator ON creator.google_sub = p.created_by
  `
  if (!row) throw createError({ statusCode: 500, statusMessage: 'Proposal could not be created' })
  return toProposal(row)
}

export async function decideGlossaryProposal(viewer: EditorDictionaryViewer, dictionaryId: string, proposalId: string, input: Record<string, unknown>): Promise<GlossaryProposal> {
  const sql = getDatabase()
  await requireTeam(sql, dictionaryId, viewer)
  const action = input.action as GlossaryDecision
  if (!['approve', 'hold', 'reject', 'resume', 'withdraw'].includes(action)) throw createError({ statusCode: 400, statusMessage: 'Invalid glossary decision' })
  const reason = action === 'hold' || action === 'reject' ? parseRequiredText(input.reason, 'Decision reason', 1000) : parseOptionalText(input.reason, 'Decision reason', 1000)
  if (action !== 'withdraw' && !isReviewerRole(viewer.role)) throw createError({ statusCode: 403, statusMessage: 'Reviewer permission is required' })
  const result = await sql.begin(async (transaction) => {
    const tx = transaction as unknown as DatabaseClient
    const [proposal] = await tx<ProposalRow[]>`SELECT ${proposalFields(tx)} FROM editor_dictionary_proposals p
      JOIN app_users creator ON creator.google_sub = p.created_by WHERE p.id = ${proposalId} AND p.dictionary_id = ${dictionaryId} FOR UPDATE OF p`
    if (!proposal) throw createError({ statusCode: 404, statusMessage: 'Proposal not found' })
    if (action === 'withdraw' && proposal.createdBy !== viewer.id) throw createError({ statusCode: 403, statusMessage: 'Only the proposal author may withdraw' })
    const status = glossaryNextStatus(proposal.status, action)
    if (!status) throw createError({ statusCode: 409, statusMessage: 'Proposal state changed' })
    let resultEntryId: string | null = null
    if (action === 'approve') {
      const metadata = parseGlossaryMetadata(proposal.metadata)
      if (metadata.semanticReview === 'unresolved') throw createError({ statusCode: 409, statusMessage: 'Resolve the language meaning difference before approval' })
      if (proposal.entryId) {
        const [current] = await tx<{ revision: number }[]>`SELECT revision FROM editor_dictionary_entries
          WHERE id = ${proposal.entryId} AND dictionary_id = ${dictionaryId} FOR UPDATE`
        if (!current || current.revision !== proposal.baseRevision) throw createError({ statusCode: 409, statusMessage: 'Glossary revision changed' })
        await tx`UPDATE editor_dictionary_entries SET source_text = ${proposal.sourceText}, translation = ${proposal.translation}, note = ${proposal.note},
          metadata = ${tx.json({ ...metadata })}, revision = revision + 1, updated_at = now() WHERE id = ${proposal.entryId}`
        resultEntryId = proposal.entryId
      } else {
        resultEntryId = randomUUID()
        await tx`INSERT INTO editor_dictionary_entries (id, dictionary_id, source_text, translation, note, metadata, created_by)
          VALUES (${resultEntryId}, ${dictionaryId}, ${proposal.sourceText}, ${proposal.translation}, ${proposal.note}, ${tx.json({ ...metadata })}, ${proposal.createdBy})`
      }
      await tx`UPDATE editor_dictionaries SET updated_at = now() WHERE id = ${dictionaryId}`
    }
    const history = [...proposal.history, { action, reason, actor: viewer.id, at: new Date().toISOString() }]
    const [row] = await tx<ProposalRow[]>`WITH saved AS (
      UPDATE editor_dictionary_proposals SET status = ${status}, result_entry_id = COALESCE(${resultEntryId}::uuid, result_entry_id),
        history = ${tx.json(history.map(event => ({ ...event })))}, updated_at = now() WHERE id = ${proposalId} RETURNING *
      ) SELECT ${proposalFields(tx)} FROM saved p JOIN app_users creator ON creator.google_sub = p.created_by`
    if (!row) throw createError({ statusCode: 500, statusMessage: 'Proposal could not be reviewed' })
    return toProposal(row)
  })
  return result as unknown as GlossaryProposal
}

export async function getGlossaryContext(itemId: string): Promise<GlossaryContextResponse> {
  const sql = getDatabase()
  const [source] = await sql<{ jp: string, cnS: string, cnT: string, category: string, unitKey: string }[]>`
    SELECT jp, cn_s AS "cnS", cn_t AS "cnT", namespace AS category, unit_key AS "unitKey" FROM current_source_texts WHERE unit_id = ${itemId}`
  if (!source) throw createError({ statusCode: 404, statusMessage: 'Translation item not found' })
  const rows = await sql<DictionaryEntryRow[]>`SELECT ${entryFields(sql)} FROM editor_dictionary_entries e
    JOIN editor_dictionaries d ON d.id = e.dictionary_id JOIN app_users creator ON creator.google_sub = e.created_by
    WHERE d.is_team AND d.visibility = 'public' ORDER BY e.translation, e.id`
  const entries = rows.map(toEntry)
  return { entries: entries.filter(entry => glossarySourceMatches(entry.metadata, source)), voices: entries.filter(entry => entry.metadata.kind === 'voice' && !entry.metadata.archived) }
}
