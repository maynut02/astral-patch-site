import type {
  EditorDiffMode,
  EditorLanguage,
  EditorSearchMatch,
  EditorSearchType
} from '#shared/types/editor'

export interface EditorOption<T extends string> {
  key: T
  label: string
}

export interface EditorDiffModeOption extends EditorOption<EditorDiffMode> {
  description: string
}

export interface EditorLanguageOption extends EditorOption<EditorLanguage> {
  lang: string
}

export const EDITOR_SOURCE_LANGUAGE_OPTIONS: EditorLanguageOption[] = [
  { key: 'cnS', label: '중국어 간체', lang: 'zh-CN' },
  { key: 'en', label: '영어', lang: 'en' },
  { key: 'jp', label: '일본어', lang: 'ja' },
  { key: 'cnT', label: '중국어 번체', lang: 'zh-TW' }
]

export const EDITOR_SEARCH_TYPE_OPTIONS: EditorOption<EditorSearchType>[] = [
  { key: 'all', label: '전체' },
  { key: 'content', label: '원문+번역 내용' },
  { key: 'source', label: '원문 내용' },
  { key: 'translation', label: '번역 내용' },
  { key: 'key', label: 'Key' }
]

export const EDITOR_SEARCH_MATCH_OPTIONS: EditorOption<EditorSearchMatch>[] = [
  { key: 'contains', label: '포함' },
  { key: 'exact', label: '정확히 일치' }
]

export const EDITOR_DIFF_MODE_OPTIONS: EditorDiffModeOption[] = [
  { key: 'unified', label: '통합 비교', description: '변경 전·후를 한 줄에서 비교' },
  { key: 'split', label: '분할 비교', description: '변경 전·후를 각각 표시' }
]

export const EDITOR_SEARCH_TYPE_LABELS = Object.fromEntries(
  EDITOR_SEARCH_TYPE_OPTIONS.map(option => [option.key, option.label])
) as Record<EditorSearchType, string>

export const EDITOR_SEARCH_MATCH_LABELS = Object.fromEntries(
  EDITOR_SEARCH_MATCH_OPTIONS.map(option => [option.key, option.label])
) as Record<EditorSearchMatch, string>

export function isEditorLanguage(value: unknown): value is EditorLanguage {
  return EDITOR_SOURCE_LANGUAGE_OPTIONS.some(option => option.key === value)
}

export function isEditorDiffMode(value: unknown): value is EditorDiffMode {
  return value === 'unified' || value === 'split'
}
