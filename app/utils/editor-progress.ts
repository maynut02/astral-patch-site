import type { EditorChangeStatus, EditorItem, EditorItemsResponse } from '#shared/types/editor'
import {
  EDITOR_PROGRESS_STATUSES,
  type EditorOverviewResponse,
  type EditorProgressCounts,
  type EditorProgressStatus
} from '#shared/types/editor-overview'

export interface ProgressSegment {
  status: EditorProgressStatus
  percentage: number
  isLast: boolean
}

export { EDITOR_PROGRESS_STATUSES }

export const EDITOR_VISIBLE_STATUSES: EditorProgressStatus[] = ['success', 'info', 'warning', 'untranslated']

export const EDITOR_STATUS_META: Record<EditorProgressStatus, {
  label: string
  color: string
  textColor: string
}> = {
  success: {
    label: '번역 완료',
    color: 'bg-[#81C995]',
    textColor: 'text-[#81C995]'
  },
  info: {
    label: '승인 대기',
    color: 'bg-[#8AB4F8]',
    textColor: 'text-[#8AB4F8]'
  },
  warning: {
    label: '확인 필요',
    color: 'bg-[#FDD663]',
    textColor: 'text-[#FDD663]'
  },
  untranslated: {
    label: '미번역',
    color: 'bg-[#F28B82]',
    textColor: 'text-[#F28B82]'
  }
}

// 번역 변경 요청 상태의 표시 이름과 UBadge 색상.
export const EDITOR_CHANGE_STATUS_META: Record<EditorChangeStatus, {
  label: string
  color: 'warning' | 'success' | 'error' | 'neutral'
}> = {
  pending: { label: '승인 대기', color: 'warning' },
  approved: { label: '승인됨', color: 'success' },
  rejected: { label: '반려됨', color: 'error' },
  superseded: { label: '자동 종료', color: 'neutral' }
}

export function createEmptyEditorOverview(): EditorOverviewResponse {
  return {
    overall: {
      total: 0,
      success: 0,
      info: 0,
      warning: 0,
      untranslated: 0
    },
    categories: [],
    versions: []
  }
}

export function createEmptyEditorItems(): EditorItemsResponse {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1
  }
}

// 저장된 번역 상태로 항목의 진행 상태를 판정한다. 서버 SQL(translation_workbench)과 같은 규칙.
export function getEditorItemStatus(
  state: Pick<EditorItem, 'ko' | 'pendingStatus' | 'approvedForCurrentSource'>
): EditorProgressStatus {
  if (state.pendingStatus === 'pending') {
    return 'info'
  }

  if (!state.ko.trim()) {
    return 'untranslated'
  }

  return state.approvedForCurrentSource === true ? 'success' : 'warning'
}

export function getProgressSegments(counts: EditorProgressCounts, total: number): ProgressSegment[] {
  const segments = EDITOR_PROGRESS_STATUSES
    .filter(status => counts[status] > 0)
    .map(status => ({
      status,
      percentage: total > 0 ? (counts[status] / total) * 100 : 0
    }))

  return segments.map((segment, index) => ({
    ...segment,
    isLast: index === segments.length - 1
  }))
}
