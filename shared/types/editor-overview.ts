export const EDITOR_PROGRESS_STATUSES = ['success', 'info', 'warning', 'untranslated'] as const

export type EditorProgressStatus = typeof EDITOR_PROGRESS_STATUSES[number]

export type EditorProgressCounts = Record<EditorProgressStatus, number>

export interface EditorProgressSummary extends EditorProgressCounts {
  total: number
}

export interface EditorCategoryProgress {
  category: string
  total: number
  counts: EditorProgressCounts
}

export interface EditorVersionProgress {
  id: string
  version: string
  revision: string
  total: number
  counts: EditorProgressCounts
}

export interface EditorOverviewResponse {
  overall: EditorProgressSummary
  categories: EditorCategoryProgress[]
  versions: EditorVersionProgress[]
}
