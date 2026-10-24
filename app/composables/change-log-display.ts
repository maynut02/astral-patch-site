import type { EditorChangeStatus, EditorSourceChangeEntry, EditorTranslationLogEntry, EditorLanguage } from '#shared/types/editor'

import { normalizeEditorHandle } from '~/utils/editor-helpers'
import { EDITOR_SOURCE_LANGUAGE_OPTIONS } from '~/utils/editor-options'
import { EDITOR_CHANGE_STATUS_META } from '~/utils/editor-progress'
import {
  getEditorDiffParts,
  getEditorSideDiffParts,
  type EditorDiffPart
} from '~/utils/editor-diff'

interface LogDiffValue {
  key: string
  label: string
  lang: string
  parts: EditorDiffPart[]
  beforeParts: EditorDiffPart[]
  afterParts: EditorDiffPart[]
}

interface TranslationStatusMeta {
  icon: string
  containerClass: string
  borderClass: string
  resultIcon: string
  resultIconClass: string
  resultLabel: string
  resultLabelClass: string
}

export const ALL_STATUS_VALUE = '__all_status__'
export const BOT_HANDLE = 'Bot'

export const tabItems = [
  { label: '번역 수정', value: 'translations' },
  { label: '원문 변경', value: 'source' }
]

export const translationStatuses: EditorChangeStatus[] = ['pending', 'approved', 'rejected', 'superseded']

export const statusItems = [
  { label: '모든 상태', value: ALL_STATUS_VALUE },
  ...translationStatuses.map(value => ({ label: EDITOR_CHANGE_STATUS_META[value].label, value }))
]

export const sourceLanguageItems = EDITOR_SOURCE_LANGUAGE_OPTIONS

export const translationStatusTextColors: Record<EditorChangeStatus, string> = {
  pending: 'text-warning',
  approved: 'text-success',
  rejected: 'text-error',
  superseded: 'text-muted'
}

export const sourceChangeLabels = {
  added: '원문 추가',
  modified: '원문 변경',
  removed: '원문 삭제'
} as const

export function getTranslationHandle(entry: EditorTranslationLogEntry): string {
  return normalizeEditorHandle(entry.handle)
}

export function getReviewerHandle(entry: EditorTranslationLogEntry): string {
  return normalizeEditorHandle(entry.reviewerHandle)
}

export function getReviewActionLabel(status: EditorChangeStatus): string {
  return getTranslationStatusMeta(status).resultLabel
}

function getSourceValue(
  entry: EditorSourceChangeEntry,
  side: 'before' | 'after',
  language: EditorLanguage
): string | null {
  const values = side === 'before'
    ? {
        cnS: entry.beforeCnS,
        en: entry.beforeEn,
        jp: entry.beforeJp,
        cnT: entry.beforeCnT
      }
    : {
        cnS: entry.afterCnS,
        en: entry.afterEn,
        jp: entry.afterJp,
        cnT: entry.afterCnT
      }

  return values[language]
}

function makeUnifiedDiffValue(
  key: string,
  label: string,
  lang: string,
  before: string | null,
  after: string | null
): LogDiffValue {
  const parts = getEditorDiffParts(before ?? '', after ?? '')

  return {
    key,
    label,
    lang,
    parts,
    beforeParts: getEditorSideDiffParts(parts, 'before'),
    afterParts: getEditorSideDiffParts(parts, 'after')
  }
}

export function getTranslationDiffParts(entry: EditorTranslationLogEntry): EditorDiffPart[] {
  return getEditorDiffParts(entry.previousText ?? '', entry.proposedText)
}

export function getTranslationSideDiffParts(
  entry: EditorTranslationLogEntry,
  side: 'before' | 'after'
): EditorDiffPart[] {
  return getEditorSideDiffParts(getTranslationDiffParts(entry), side)
}

export function getSourceDiffValues(entry: EditorSourceChangeEntry): LogDiffValue[] {
  return sourceLanguageItems
    .map(language => makeUnifiedDiffValue(
      language.key,
      language.label,
      language.lang,
      getSourceValue(entry, 'before', language.key),
      getSourceValue(entry, 'after', language.key)
    ))
    .filter((value, index) => {
      const language = sourceLanguageItems[index]!
      return getSourceValue(entry, 'before', language.key) !== getSourceValue(entry, 'after', language.key)
    })
}

const TRANSLATION_STATUS_META: Record<EditorChangeStatus, TranslationStatusMeta> = {
  pending: {
    icon: 'i-tabler-clock-hour-4',
    containerClass: 'bg-warning/15 text-warning',
    borderClass: 'border-warning',
    resultIcon: 'i-tabler-hourglass-empty',
    resultIconClass: 'text-warning',
    resultLabel: '승인 대기',
    resultLabelClass: 'text-warning'
  },
  approved: {
    icon: 'i-tabler-check',
    containerClass: 'bg-success/15 text-success',
    borderClass: 'border-success',
    resultIcon: 'i-tabler-check',
    resultIconClass: 'text-success',
    resultLabel: '승인',
    resultLabelClass: 'text-success'
  },
  rejected: {
    icon: 'i-tabler-x',
    containerClass: 'bg-error/15 text-error',
    borderClass: 'border-error',
    resultIcon: 'i-tabler-x',
    resultIconClass: 'text-error',
    resultLabel: '반려',
    resultLabelClass: 'text-error'
  },
  superseded: {
    icon: 'i-tabler-replace',
    containerClass: 'bg-elevated text-muted',
    borderClass: 'border-muted',
    resultIcon: 'i-tabler-minus',
    resultIconClass: 'text-muted',
    resultLabel: '종료',
    resultLabelClass: 'text-muted'
  }
}

export function getTranslationStatusMeta(status: EditorChangeStatus): TranslationStatusMeta {
  return TRANSLATION_STATUS_META[status]
}

export function getSourceBorderClass(changeType: EditorSourceChangeEntry['changeType']): string {
  return {
    added: 'border-success',
    modified: 'border-warning',
    removed: 'border-error'
  }[changeType]
}

export function getSourceTextClass(changeType: EditorSourceChangeEntry['changeType']): string {
  return {
    added: 'text-success',
    modified: 'text-warning',
    removed: 'text-error'
  }[changeType]
}

export function getSourceActionIcon(changeType: EditorSourceChangeEntry['changeType']): string {
  return {
    added: 'i-tabler-database-plus',
    modified: 'i-tabler-database-import',
    removed: 'i-tabler-database-minus'
  }[changeType]
}
