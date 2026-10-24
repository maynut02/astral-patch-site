import type {
  PatchWatcherHourlyStat,
  PatchWatcherHourState,
  PatchWatcherOverallState,
  PatchWatcherRoute,
  PatchWatcherRouteStatus,
  PatchWatcherRunStatus,
  PatchWatcherRunSummary
} from '#shared/types/status'

export const ROUTES: PatchWatcherRoute[] = ['INT_STEAM', 'CN_STEAM', 'INT_ANDROID', 'CN_ANDROID']
export const WATCH_INTERVAL_MINUTES = 5
export const DELAYED_AFTER_MINUTES = 10
export const OUTAGE_AFTER_MINUTES = 20
export const HISTORY_PAGE_SIZE = 20

export interface WatcherConfigRow {
  gameVersion: string
  enabled: boolean
  updatedAt: Date
}

export interface WatchRunRow {
  id: number
  gameVersion: string | null
  status: PatchWatcherRunStatus
  workflowDispatched: boolean
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  errorMessage: string | null
}

export interface RouteStateRow {
  route: PatchWatcherRoute
  gameVersion: string | null
  revision: string | null
  observedAt: Date | null
  status: Exclude<PatchWatcherRouteStatus, 'unknown'> | null
  checkedAt: Date | null
  durationMs: number | null
  errorMessage: string | null
}

export interface HourlyStatRow {
  route: PatchWatcherRoute
  hour: string
  total: number
  success: number
  failure: number
  disabled: boolean
}

export interface HistoryRunRow extends WatchRunRow {
  routes: Array<{
    route: PatchWatcherRoute
    status: Exclude<PatchWatcherRouteStatus, 'unknown'>
    revision: string | null
    durationMs: number | null
    errorMessage: string | null
  }>
}

export function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function getRunMessage(status: PatchWatcherRunStatus): string | null {
  switch (status) {
    case 'partial_failure':
      return '일부 경로의 패치 감지에 실패했습니다.'
    case 'failed':
      return '패치 감지 중 오류가 발생했습니다.'
    case 'disabled':
      return '패치 감지가 비활성화되어 있습니다.'
    case 'skipped_locked':
      return '이전 감지가 진행 중이어서 이번 실행을 건너뛰었습니다.'
    default:
      return null
  }
}

export function getRouteMessage(status: PatchWatcherRouteStatus): string | null {
  switch (status) {
    case 'change_detected':
      return '게임 업데이트가 감지되었습니다.'
    case 'waiting_processing':
      return '감지된 업데이트의 패치 처리를 기다리고 있습니다.'
    case 'dispatched':
      return '패치 생성 작업을 요청했습니다.'
    case 'failed':
      return '이 경로의 패치 감지에 실패했습니다.'
    case 'unknown':
      return '아직 감지 기록이 없습니다.'
    default:
      return null
  }
}

export function toRunSummary(row: WatchRunRow): PatchWatcherRunSummary {
  return {
    id: Number(row.id),
    status: row.status,
    gameVersion: row.gameVersion,
    workflowDispatched: row.workflowDispatched,
    startedAt: row.startedAt.toISOString(),
    finishedAt: toIso(row.finishedAt),
    durationMs: row.durationMs === null ? null : Number(row.durationMs),
    errorMessage: row.errorMessage,
    message: getRunMessage(row.status)
  }
}

export function getOverallState(
  enabled: boolean,
  latestActivity: WatchRunRow | undefined,
  latestEffectiveRun: WatchRunRow | undefined,
  now: number
): { state: PatchWatcherOverallState, message: string } {
  if (!enabled) {
    return { state: 'paused', message: '패치 감지가 현재 비활성화되어 있습니다.' }
  }

  if (!latestActivity) {
    return { state: 'degraded', message: '아직 패치 감지 실행 기록이 없습니다.' }
  }

  const activityAgeMinutes = Math.max(0, now - latestActivity.startedAt.getTime()) / 60_000

  if (activityAgeMinutes >= OUTAGE_AFTER_MINUTES) {
    return { state: 'outage', message: '20분 이상 새로운 패치 감지 기록이 없습니다.' }
  }

  if (activityAgeMinutes >= DELAYED_AFTER_MINUTES) {
    return { state: 'degraded', message: '패치 감지 기록이 평소보다 늦게 갱신되고 있습니다.' }
  }

  if (!latestEffectiveRun) {
    return { state: 'degraded', message: '정상적으로 완료된 패치 감지 기록을 확인할 수 없습니다.' }
  }

  if (latestEffectiveRun.status === 'running') {
    const runningMinutes = Math.max(0, now - latestEffectiveRun.startedAt.getTime()) / 60_000

    if (runningMinutes >= OUTAGE_AFTER_MINUTES) {
      return { state: 'outage', message: '패치 감지 작업이 20분 이상 완료되지 않고 있습니다.' }
    }

    if (runningMinutes >= DELAYED_AFTER_MINUTES) {
      return { state: 'degraded', message: '패치 감지 작업이 평소보다 오래 진행되고 있습니다.' }
    }

    return { state: 'checking', message: '패치 업데이트 여부를 확인하고 있습니다.' }
  }

  if (latestEffectiveRun.status === 'failed') {
    return { state: 'outage', message: '최근 패치 감지 실행이 실패했습니다.' }
  }

  if (latestEffectiveRun.status === 'partial_failure') {
    return { state: 'degraded', message: '일부 경로의 최근 패치 감지에 문제가 발생했습니다.' }
  }

  if (latestEffectiveRun.status === 'disabled') {
    return { state: 'degraded', message: '패치 감지가 다시 활성화되어 다음 실행을 기다리고 있습니다.' }
  }

  return { state: 'operational', message: '모든 패치 감지 경로가 정상적으로 동작하고 있습니다.' }
}

function getHourState(row: HourlyStatRow): PatchWatcherHourState {
  if (row.total === 0) {
    return row.disabled ? 'paused' : 'no_data'
  }

  return row.failure > 0 ? 'error' : 'operational'
}

export function toHourlyStat(row: HourlyStatRow): PatchWatcherHourlyStat {
  const total = Number(row.total)
  const success = Number(row.success)
  const failure = Number(row.failure)

  return {
    hour: row.hour,
    total,
    success,
    failure,
    successRate: total > 0 ? Math.round((success / total) * 10_000) / 100 : null,
    state: getHourState({ ...row, total, success, failure })
  }
}
