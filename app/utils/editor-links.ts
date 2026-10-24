import { normalizeEditorRevision, normalizeEditorVersion } from '~/utils/editor-helpers'

interface EditorItemRef {
  category: string
  unitKey: string
}

// 라우터 LocationQueryRaw에 넘길 수 있도록 interface 대신 type alias로 둔다.
export type EditorKeyQuery = {
  file?: string
  search: string
  searchType: 'key'
  match: 'exact'
  page: '1'
}

export function getEditorItemKey(item: EditorItemRef): string {
  return `${item.category}_${item.unitKey}`
}

// 에디터에서 특정 키 하나를 정확히 찾는 쿼리. file이 있으면 해당 파일 모드로 연다.
export function getEditorKeyQuery(key: string, file?: string): EditorKeyQuery {
  return {
    ...(file ? { file } : {}),
    search: key,
    searchType: 'key',
    match: 'exact',
    page: '1'
  }
}

export function getEditorItemLocation(item: EditorItemRef): { path: '/translate/editor', query: EditorKeyQuery } {
  return {
    path: '/translate/editor',
    query: getEditorKeyQuery(getEditorItemKey(item), item.category)
  }
}

export function getEditorCategoryPath(category: string): string {
  return `/translate/editor?file=${encodeURIComponent(category)}`
}

export function getEditorVersionPath(version: string, revision: string): string {
  return `/translate/editor?version=${encodeURIComponent(normalizeEditorVersion(version))}&revision=${encodeURIComponent(normalizeEditorRevision(revision))}`
}
