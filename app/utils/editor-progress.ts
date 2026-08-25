import {
  EDITOR_PROGRESS_STATUSES,
  type EditorProgressCounts,
  type EditorProgressStatus
} from '#shared/types/editor-overview'

export interface ProgressSegment {
  status: EditorProgressStatus
  percentage: number
  isLast: boolean
}

export { EDITOR_PROGRESS_STATUSES }

export const EDITOR_VISIBLE_STATUSES: EditorProgressStatus[] = ['success', 'info', 'warning']

export const EDITOR_STATUS_META: Record<EditorProgressStatus, {
  label: string
  color: string
}> = {
  success: {
    label: '번역 완료',
    color: 'bg-[#81C995]'
  },
  info: {
    label: '승인 대기',
    color: 'bg-[#8AB4F8]'
  },
  warning: {
    label: '확인 필요',
    color: 'bg-[#FDD663]'
  },
  untranslated: {
    label: '미번역',
    color: 'bg-[#F28B82]'
  }
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
