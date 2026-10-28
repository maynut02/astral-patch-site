import { resolveUserRole, type UserRole } from './user'

export type EditorLanguage = 'cnS' | 'en' | 'jp' | 'cnT'
export type EditorRole = UserRole

export function resolveEditorRole(user: { role?: unknown } | null | undefined): EditorRole {
  return resolveUserRole(user?.role)
}

export type EditorSearchType = 'all' | 'content' | 'key' | 'source' | 'translation'

export type EditorSearchMatch = 'contains' | 'exact'

export type EditorItemStatusFilter = 'untranslated' | 'pending' | 'warning'

export type EditorDiffMode = 'unified' | 'split'

export const EDITOR_ALL_CATEGORY_VALUE = '__all_category__'
export const EDITOR_ALL_REVISION_VALUE = '__all_revision__'
export const MAX_TRANSLATION_CHARACTERS = 10_000

export type EditorChangeStatus = 'pending' | 'approved' | 'rejected' | 'superseded'
export type EditorChangeKind = 'translation_edit' | 'retain_confirmation'

export type EditorHistoryAction = 'source_changed' | 'translation_changed'

export type EditorHistoryActorType = 'automation' | 'user'

export interface EditorTranslationPublication {
  number: number
  gameVersion: string
  revision: string
}

export interface EditorItem {
  id: string
  kind: 'lang' | 'str'
  category: string
  unitKey: string
  sourceVersionId: string
  cnS: string
  en: string
  jp: string
  cnT: string
  ko: string
  pendingKo: string | null
  pendingStatus: EditorChangeStatus | null
  approvedForCurrentSource: boolean | null
}

export interface EditorHistoryEntry {
  id: string
  action: EditorHistoryAction
  actorType: EditorHistoryActorType
  actorRole: EditorRole
  handle: string | null
  status: EditorChangeStatus | null
  changeKind: EditorChangeKind | null
  reviewerRole: EditorRole | null
  reviewerHandle: string | null
  reviewedAt: string | null
  publication: EditorTranslationPublication | null
  changeType: EditorSourceChangeType | null
  version: string | null
  revision: string | null
  previousText: string | null
  proposedText: string | null
  beforeCnS: string | null
  beforeEn: string | null
  beforeJp: string | null
  beforeCnT: string | null
  afterCnS: string | null
  afterEn: string | null
  afterJp: string | null
  afterCnT: string | null
  createdAt: string
}

export interface EditorHistoryResponse {
  entries: EditorHistoryEntry[]
}

export interface EditorSaveResponse {
  changed: boolean
  changeId: string | null
  ko: string
  status: EditorChangeStatus | null
}

export interface EditorBatchSaveResult {
  itemId: string
  ok: boolean
  response: EditorSaveResponse | null
  error: string | null
}

export interface EditorBatchSaveResponse {
  results: EditorBatchSaveResult[]
}

export interface EditorAiTranslationResponse {
  itemId: string
  sourceVersionId: string
  text: string
}

export type EditorReviewAction = 'approve' | 'reject'

export interface EditorReviewResponse {
  changeId: string
  status: Exclude<EditorChangeStatus, 'pending' | 'superseded'>
}

export interface EditorBatchReviewResult {
  changeId: string
  ok: boolean
  response: EditorReviewResponse | null
  error: string | null
}

export interface EditorBatchReviewResponse {
  results: EditorBatchReviewResult[]
}

export interface EditorReviewCandidateGroup {
  unitId: string
  kind: 'lang' | 'str'
  category: string
  unitKey: string
  candidates: EditorTranslationLogEntry[]
}

export interface EditorReviewCandidatesResponse {
  groups: EditorReviewCandidateGroup[]
}

export interface EditorItemsResponse {
  items: EditorItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface EditorTranslationLogEntry {
  id: string
  unitId: string
  kind: 'lang' | 'str'
  category: string
  unitKey: string
  actorRole: EditorRole
  handle: string | null
  reviewerRole: EditorRole | null
  reviewerHandle: string | null
  previousText: string | null
  proposedText: string
  changeKind: EditorChangeKind
  pendingCandidateCount?: number
  status: EditorChangeStatus
  createdAt: string
  reviewedAt: string | null
  publication: EditorTranslationPublication | null
}

export interface EditorTranslationLogResponse {
  entries: EditorTranslationLogEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface EditorTranslationLogSummary {
  pending: number
  approved: number
  rejected: number
  superseded: number
}

export interface EditorSourceRevision {
  id: string
  gameVersion: string
  revision: string
  detectedAt: string
  processedAt: string | null
  totalChanges: number
  addedCount: number
  modifiedCount: number
  removedCount: number
}

export interface EditorSourceRevisionsResponse {
  revisions: EditorSourceRevision[]
}

export type EditorSourceChangeType = 'added' | 'modified' | 'removed'

export interface EditorSourceChangeEntry {
  id: string
  revisionId: string
  unitId: string
  kind: 'lang' | 'str'
  category: string
  unitKey: string
  changeType: EditorSourceChangeType
  beforeCnS: string | null
  beforeEn: string | null
  beforeJp: string | null
  beforeCnT: string | null
  afterCnS: string | null
  afterEn: string | null
  afterJp: string | null
  afterCnT: string | null
  createdAt: string
}

export interface EditorSourceChangesResponse {
  entries: EditorSourceChangeEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
