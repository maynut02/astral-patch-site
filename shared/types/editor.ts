export type EditorLanguage = 'cnS' | 'en' | 'jp' | 'cnT'

export const EDITOR_ALL_CATEGORY_VALUE = '__all_category__'
export const EDITOR_ALL_REVISION_VALUE = '__all_revision__'

export interface EditorSelectOption {
  label: string
  value: string
}

export interface EditorFiltersResponse {
  categories: EditorSelectOption[]
  revisions: EditorSelectOption[]
}

export type EditorChangeStatus = 'pending' | 'approved' | 'rejected' | 'superseded'

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
  nickname: string
  previousText: string | null
  proposedText: string
  status: EditorChangeStatus
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

export type EditorReviewAction = 'approve' | 'reject'

export interface EditorReviewResponse {
  changeId: string
  status: Exclude<EditorChangeStatus, 'pending' | 'superseded'>
}

export interface EditorItemsResponse {
  items: EditorItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
