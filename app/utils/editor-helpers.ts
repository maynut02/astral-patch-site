import type { EditorSearchMatch, EditorSearchType } from '#shared/types/editor'

export function getEditorQueryString(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

export function normalizeEditorHandle(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^@+/, '') : ''
}

export function normalizeEditorVersion(value: unknown): string {
  return getEditorQueryString(value).trim().replace(/^v/i, '')
}

export function normalizeEditorRevision(value: unknown): string {
  return getEditorQueryString(value).trim().replace(/^r/i, '')
}

export function formatEditorVersion(version: string | null | undefined, revision: string | null | undefined, omitEmptyParts = false): string {
  const normalizedVersion = normalizeEditorVersion(version)
  const normalizedRevision = normalizeEditorRevision(revision)
  if (omitEmptyParts && (!normalizedVersion || !normalizedRevision)) {
    return normalizedVersion ? `v${normalizedVersion}` : normalizedRevision ? `r${normalizedRevision}` : ''
  }
  return `v${normalizedVersion} · r${normalizedRevision}`
}

export function formatEditorCount(value: number): string {
  return value.toLocaleString('ko-KR')
}

export function formatEditorPercent(count: number, total: number): string {
  if (!total) {
    return '0.0%'
  }

  const percentage = (count / total) * 100

  if (count > 0 && percentage < 0.1) {
    return '<0.1%'
  }

  return `${percentage.toFixed(1)}%`
}

const editorDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  dateStyle: 'medium',
  timeStyle: 'short'
})

export function formatEditorDate(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return editorDateFormatter.format(date)
}

export function isEditorSearchType(value: unknown): value is EditorSearchType {
  return value === 'all' || value === 'content' || value === 'key' || value === 'source' || value === 'translation'
}

export function isEditorSearchMatch(value: unknown): value is EditorSearchMatch {
  return value === 'contains' || value === 'exact'
}
