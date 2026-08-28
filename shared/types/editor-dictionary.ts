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
}

export interface EditorDictionaryEntriesResponse {
  entries: EditorDictionaryEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
