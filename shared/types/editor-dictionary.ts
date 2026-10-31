import type { UserRole } from './user'

export type EditorDictionaryVisibility = 'public' | 'private'

export interface EditorDictionary {
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
  canEdit: boolean
  isTeam: boolean
}

export interface EditorDictionariesResponse {
  dictionaries: EditorDictionary[]
}

export interface EditorDictionaryEntry {
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
  metadata: GlossaryMetadata
  revision: number
}

export interface EditorDictionaryEntriesResponse {
  entries: EditorDictionaryEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface GlossaryMetadata {
  archived: boolean
  kind: 'term' | 'voice'
  japanese: string
  chineseSimplified: string
  chineseTraditional: string
  allowed: string[]
  historical: string[]
  discouraged: string[]
  scope: 'project' | 'file' | 'entry' | 'character'
  target: string
  semanticReview: 'unrecorded' | 'recorded' | 'unresolved'
  semanticNote: string
  evidenceKey: string
  speechStyle: string
  selfAddress: string
  otherAddress: string
  endings: string
  exceptions: string
  exampleSource: string
  exampleTranslation: string
}

export type GlossaryProposalStatus = 'pending' | 'held' | 'approved' | 'rejected' | 'withdrawn'
export type GlossaryDecision = 'approve' | 'hold' | 'reject' | 'resume' | 'withdraw'
export type GlossaryChangeKind = 'new' | 'terminology' | 'meaning' | 'style'

export interface GlossaryProposal {
  id: string
  dictionaryId: string
  entryId: string | null
  resultEntryId: string | null
  baseRevision: number
  sourceText: string
  translation: string
  note: string
  metadata: GlossaryMetadata
  changeKind: GlossaryChangeKind
  status: GlossaryProposalStatus
  createdBy: string
  creatorHandle: string | null
  createdAt: string
  updatedAt: string
  history: { action: GlossaryDecision, reason: string, actor: string, at: string }[]
}

export interface GlossaryProposalsResponse {
  proposals: GlossaryProposal[]
  page: number
  totalPages: number
  total: number
}

export interface GlossaryContextResponse {
  entries: EditorDictionaryEntry[]
  voices: EditorDictionaryEntry[]
}
