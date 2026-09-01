export type PatchWatcherRoute = 'INT_STEAM' | 'CN_STEAM' | 'INT_ANDROID'

export type PatchWatcherRunStatus =
  | 'running'
  | 'success'
  | 'partial_failure'
  | 'failed'
  | 'disabled'
  | 'skipped_locked'

export type PatchWatcherRouteStatus =
  | 'checking'
  | 'unchanged'
  | 'change_detected'
  | 'waiting_processing'
  | 'dispatched'
  | 'failed'
  | 'unknown'

export type PatchWatcherOverallState =
  | 'operational'
  | 'checking'
  | 'degraded'
  | 'outage'
  | 'paused'

export type PatchWatcherHourState = 'operational' | 'error' | 'paused' | 'no_data'

export interface PatchWatcherRunSummary {
  id: number
  status: PatchWatcherRunStatus
  gameVersion: string | null
  workflowDispatched: boolean
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  message: string | null
}

export interface PatchWatcherHourlyStat {
  hour: string
  total: number
  success: number
  failure: number
  successRate: number | null
  state: PatchWatcherHourState
}

export interface PatchWatcherRouteSummary {
  route: PatchWatcherRoute
  status: PatchWatcherRouteStatus
  gameVersion: string | null
  revision: string | null
  checkedAt: string | null
  observedAt: string | null
  durationMs: number | null
  message: string | null
  successRate7d: number | null
  hourly: PatchWatcherHourlyStat[]
}

export interface PatchWatcherStatusResponse {
  fetchedAt: string
  schedule: {
    intervalMinutes: number
    delayedAfterMinutes: number
    outageAfterMinutes: number
  }
  watcher: {
    enabled: boolean
    gameVersion: string
    updatedAt: string
  }
  overall: {
    state: PatchWatcherOverallState
    lastActivityAt: string | null
    message: string
  }
  latestRun: PatchWatcherRunSummary | null
  routes: PatchWatcherRouteSummary[]
}

export interface PatchWatcherHistoryRoute {
  route: PatchWatcherRoute
  status: PatchWatcherRouteStatus
  revision: string | null
  durationMs: number | null
  message: string | null
}

export interface PatchWatcherHistoryEntry extends PatchWatcherRunSummary {
  routes: PatchWatcherHistoryRoute[]
}

export interface PatchWatcherHistoryResponse {
  fetchedAt: string
  page: number
  pageSize: number
  hasMore: boolean
  entries: PatchWatcherHistoryEntry[]
}
