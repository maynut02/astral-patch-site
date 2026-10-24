import type {
  PatchWatcherHourState,
  PatchWatcherOverallState,
  PatchWatcherRoute,
  PatchWatcherRouteStatus,
  PatchWatcherRunStatus
} from '#shared/types/status'
import { PATCH_ROUTE_ITEMS } from '~/utils/patch-routes'

type StatusColor = 'success' | 'warning' | 'error' | 'info' | 'neutral'
export type HistoryFilter = 'all' | 'failed'

interface StatusMeta {
  label: string
  color: StatusColor
  icon: string
}

export const routeMeta = Object.fromEntries(
  PATCH_ROUTE_ITEMS.map(({ label, value, icon }) => [value, { label, icon }])
) as Record<PatchWatcherRoute, { label: string, icon: string }>

export const overallMeta: Record<PatchWatcherOverallState, StatusMeta> = {
  operational: { label: '정상', color: 'success', icon: 'i-tabler-circle-check-filled' },
  checking: { label: '감지 중', color: 'info', icon: 'i-tabler-loader-2' },
  degraded: { label: '일부 문제', color: 'warning', icon: 'i-tabler-alert-triangle-filled' },
  outage: { label: '감지 시스템 문제', color: 'error', icon: 'i-tabler-circle-x-filled' },
  paused: { label: '감지 비활성화', color: 'neutral', icon: 'i-tabler-player-pause-filled' }
}

export const runMeta: Record<PatchWatcherRunStatus, StatusMeta> = {
  running: { label: '감지 중', color: 'info', icon: 'i-tabler-loader-2' },
  success: { label: '정상', color: 'success', icon: 'i-tabler-check' },
  partial_failure: { label: '일부 실패', color: 'warning', icon: 'i-tabler-alert-triangle' },
  failed: { label: '실패', color: 'error', icon: 'i-tabler-x' },
  disabled: { label: '비활성화', color: 'neutral', icon: 'i-tabler-player-pause' },
  skipped_locked: { label: '건너뜀', color: 'neutral', icon: 'i-tabler-player-skip-forward' }
}

export const routeStatusMeta: Record<PatchWatcherRouteStatus, StatusMeta> = {
  checking: { label: '확인 중', color: 'info', icon: 'i-tabler-loader-2' },
  unchanged: { label: '변경 없음', color: 'success', icon: 'i-tabler-check' },
  change_detected: { label: '업데이트 감지', color: 'info', icon: 'i-tabler-radar-2' },
  waiting_processing: { label: '처리 대기', color: 'info', icon: 'i-tabler-hourglass' },
  dispatched: { label: '생성 요청 완료', color: 'info', icon: 'i-tabler-send' },
  failed: { label: '감지 실패', color: 'error', icon: 'i-tabler-x' },
  unknown: { label: '기록 없음', color: 'neutral', icon: 'i-tabler-minus' }
}

export const hourClass: Record<PatchWatcherHourState, string> = {
  operational: 'bg-success hover:bg-success/80',
  error: 'bg-error hover:bg-error/80',
  paused: 'bg-warning hover:bg-warning/80',
  no_data: 'bg-muted hover:bg-elevated'
}

export const historyTabs: Array<{ label: string, value: HistoryFilter }> = [
  { label: '전체', value: 'all' },
  { label: '실패', value: 'failed' }
]
