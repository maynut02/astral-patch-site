export type EditorDictionaryVisibility = 'public' | 'private'

export interface EditorDictionary {
  id: string
  ownerId: string
  ownerNickname: string
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
  creatorNickname: string
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
