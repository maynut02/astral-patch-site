import type {
  PatchWatcherHourlyStat,
  PatchWatcherHourState,
  PatchWatcherHistoryEntry,
  PatchWatcherHistoryResponse,
  PatchWatcherOverallState,
  PatchWatcherRoute,
  PatchWatcherRouteStatus,
  PatchWatcherRouteSummary,
  PatchWatcherRunStatus,
  PatchWatcherRunSummary,
  PatchWatcherStatusResponse
} from '#shared/types/status'
import { withDatabaseRetry } from './database'

const ROUTES: PatchWatcherRoute[] = ['INT_STEAM', 'CN_STEAM', 'INT_ANDROID', 'CN_ANDROID']
const WATCH_INTERVAL_MINUTES = 5
const DELAYED_AFTER_MINUTES = 10
const OUTAGE_AFTER_MINUTES = 20
const HISTORY_PAGE_SIZE = 20

interface WatcherConfigRow {
  gameVersion: string
  enabled: boolean
  updatedAt: Date
}

interface WatchRunRow {
  id: number
  gameVersion: string | null
  status: PatchWatcherRunStatus
  workflowDispatched: boolean
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  errorMessage: string | null
}

interface RouteStateRow {
  route: PatchWatcherRoute
  gameVersion: string | null
  revision: string | null
  observedAt: Date | null
  status: Exclude<PatchWatcherRouteStatus, 'unknown'> | null
  checkedAt: Date | null
  durationMs: number | null
  errorMessage: string | null
}

interface HourlyStatRow {
  route: PatchWatcherRoute
  hour: string
  total: number
  success: number
  failure: number
  disabled: boolean
}

interface HistoryRunRow extends WatchRunRow {
  routes: Array<{
    route: PatchWatcherRoute
    status: Exclude<PatchWatcherRouteStatus, 'unknown'>
    revision: string | null
    durationMs: number | null
    errorMessage: string | null
  }>
}

function toIso(value: Date | null): string | null {
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

function getRouteMessage(status: PatchWatcherRouteStatus): string | null {
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

function toRunSummary(row: WatchRunRow): PatchWatcherRunSummary {
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

function getOverallState(
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

function toHourlyStat(row: HourlyStatRow): PatchWatcherHourlyStat {
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

export async function getPatchWatcherStatus(): Promise<PatchWatcherStatusResponse> {
  const [configRows, activityRows, effectiveRows, routeRows, hourlyRows] = await Promise.all([
    withDatabaseRetry<WatcherConfigRow[]>(database => database<WatcherConfigRow[]>`
      SELECT
        game_version AS "gameVersion",
        enabled,
        updated_at AS "updatedAt"
      FROM patch_watch_config
      WHERE singleton = true
    `),
    withDatabaseRetry<WatchRunRow[]>(database => database<WatchRunRow[]>`
      SELECT
        id,
        game_version AS "gameVersion",
        status,
        workflow_dispatched AS "workflowDispatched",
        started_at AS "startedAt",
        finished_at AS "finishedAt",
        duration_ms AS "durationMs",
        error_message AS "errorMessage"
      FROM patch_watch_runs
      ORDER BY started_at DESC
      LIMIT 1
    `),
    withDatabaseRetry<WatchRunRow[]>(database => database<WatchRunRow[]>`
      SELECT
        id,
        game_version AS "gameVersion",
        status,
        workflow_dispatched AS "workflowDispatched",
        started_at AS "startedAt",
        finished_at AS "finishedAt",
        duration_ms AS "durationMs",
        error_message AS "errorMessage"
      FROM patch_watch_runs
      WHERE status <> 'skipped_locked'
      ORDER BY started_at DESC
      LIMIT 1
    `),
    withDatabaseRetry<RouteStateRow[]>(database => database<RouteStateRow[]>`
      SELECT
        state.route,
        COALESCE(latest.game_version, state.game_version) AS "gameVersion",
        COALESCE(latest.revision, state.revision) AS revision,
        state.observed_at AS "observedAt",
        latest.status,
        latest.started_at AS "checkedAt",
        latest.duration_ms AS "durationMs",
        latest.error_message AS "errorMessage"
      FROM patch_watch_routes AS state
      LEFT JOIN LATERAL (
        SELECT
          history.game_version,
          history.revision,
          history.status,
          history.started_at,
          history.duration_ms,
          history.error_message
        FROM patch_watch_run_routes AS history
        WHERE history.route = state.route
        ORDER BY history.started_at DESC
        LIMIT 1
      ) AS latest ON true
      ORDER BY CASE state.route
        WHEN 'INT_STEAM' THEN 1
        WHEN 'CN_STEAM' THEN 2
        WHEN 'INT_ANDROID' THEN 3
        WHEN 'CN_ANDROID' THEN 4
        ELSE 5
      END
    `),
    withDatabaseRetry<HourlyStatRow[]>(database => database<HourlyStatRow[]>`
      WITH hours AS (
        SELECT generate_series(
          date_trunc('hour', now() AT TIME ZONE 'Asia/Seoul') - interval '167 hours',
          date_trunc('hour', now() AT TIME ZONE 'Asia/Seoul'),
          interval '1 hour'
        ) AS hour
      ),
      routes(route) AS (
        VALUES ('INT_STEAM'), ('CN_STEAM'), ('INT_ANDROID'), ('CN_ANDROID')
      ),
      route_stats AS (
        SELECT
          route,
          date_trunc('hour', started_at AT TIME ZONE 'Asia/Seoul') AS hour,
          count(*) FILTER (
            WHERE status <> 'checking' OR started_at < now() - interval '10 minutes'
          )::int AS total,
          count(*) FILTER (
            WHERE status NOT IN ('failed', 'checking')
          )::int AS success,
          count(*) FILTER (
            WHERE status = 'failed'
              OR (status = 'checking' AND started_at < now() - interval '10 minutes')
          )::int AS failure
        FROM patch_watch_run_routes
        WHERE started_at >= (
          date_trunc('hour', now() AT TIME ZONE 'Asia/Seoul') - interval '167 hours'
        ) AT TIME ZONE 'Asia/Seoul'
        GROUP BY route, date_trunc('hour', started_at AT TIME ZONE 'Asia/Seoul')
      ),
      disabled_hours AS (
        SELECT DISTINCT date_trunc('hour', started_at AT TIME ZONE 'Asia/Seoul') AS hour
        FROM patch_watch_runs
        WHERE status = 'disabled'
          AND started_at >= (
            date_trunc('hour', now() AT TIME ZONE 'Asia/Seoul') - interval '167 hours'
          ) AT TIME ZONE 'Asia/Seoul'
      )
      SELECT
        routes.route,
        to_char(hours.hour, 'YYYY-MM-DD"T"HH24:00:00+09:00') AS hour,
        COALESCE(route_stats.total, 0)::int AS total,
        COALESCE(route_stats.success, 0)::int AS success,
        COALESCE(route_stats.failure, 0)::int AS failure,
        (disabled_hours.hour IS NOT NULL) AS disabled
      FROM hours
      CROSS JOIN routes
      LEFT JOIN route_stats
        ON route_stats.route = routes.route
        AND route_stats.hour = hours.hour
      LEFT JOIN disabled_hours ON disabled_hours.hour = hours.hour
      ORDER BY routes.route, hours.hour
    `)
  ])

  const config = configRows[0]
  if (!config) {
    throw new Error('Patch watcher configuration is missing')
  }

  const latestActivity = activityRows[0]
  const latestEffectiveRun = effectiveRows[0]
  const now = Date.now()
  const overall = getOverallState(config.enabled, latestActivity, latestEffectiveRun, now)

  const hourlyByRoute = new Map<PatchWatcherRoute, PatchWatcherHourlyStat[]>()
  for (const route of ROUTES) {
    hourlyByRoute.set(route, [])
  }

  for (const row of hourlyRows) {
    hourlyByRoute.get(row.route)?.push(toHourlyStat(row))
  }

  const routes: PatchWatcherRouteSummary[] = routeRows.map((row) => {
    const hourly = hourlyByRoute.get(row.route) ?? []
    const total = hourly.reduce((sum, hour) => sum + hour.total, 0)
    const success = hourly.reduce((sum, hour) => sum + hour.success, 0)
    const isStaleChecking = row.status === 'checking'
      && row.checkedAt !== null
      && now - row.checkedAt.getTime() >= DELAYED_AFTER_MINUTES * 60_000
    const routeStatus = isStaleChecking ? 'failed' : (row.status ?? 'unknown')

    return {
      route: row.route,
      status: routeStatus,
      gameVersion: row.gameVersion,
      revision: row.revision,
      checkedAt: toIso(row.checkedAt),
      observedAt: toIso(row.observedAt),
      durationMs: row.durationMs === null ? null : Number(row.durationMs),
      errorMessage: row.errorMessage,
      message: getRouteMessage(routeStatus),
      successRate7d: total > 0 ? Math.round((success / total) * 10_000) / 100 : null,
      hourly
    }
  })

  return {
    fetchedAt: new Date().toISOString(),
    schedule: {
      intervalMinutes: WATCH_INTERVAL_MINUTES,
      delayedAfterMinutes: DELAYED_AFTER_MINUTES,
      outageAfterMinutes: OUTAGE_AFTER_MINUTES
    },
    watcher: {
      enabled: config.enabled,
      gameVersion: config.gameVersion,
      updatedAt: config.updatedAt.toISOString()
    },
    overall: {
      ...overall,
      lastActivityAt: latestActivity?.startedAt.toISOString() ?? null
    },
    latestRun: latestEffectiveRun ? toRunSummary(latestEffectiveRun) : null,
    routes
  }
}

export async function getPatchWatcherHistory(
  page: number,
  failuresOnly = false
): Promise<PatchWatcherHistoryResponse> {
  const offset = (page - 1) * HISTORY_PAGE_SIZE
  const rows = await withDatabaseRetry<HistoryRunRow[]>(database => database<HistoryRunRow[]>`
    SELECT
      run.id,
      run.game_version AS "gameVersion",
      run.status,
      run.workflow_dispatched AS "workflowDispatched",
      run.started_at AS "startedAt",
      run.finished_at AS "finishedAt",
      run.duration_ms AS "durationMs",
      run.error_message AS "errorMessage",
      COALESCE(
        json_agg(
          json_build_object(
            'route', route.route,
            'status', route.status,
            'revision', route.revision,
            'durationMs', route.duration_ms,
            'errorMessage', route.error_message
          ) ORDER BY CASE route.route
            WHEN 'INT_STEAM' THEN 1
            WHEN 'CN_STEAM' THEN 2
            WHEN 'INT_ANDROID' THEN 3
            WHEN 'CN_ANDROID' THEN 4
            ELSE 5
          END
        ) FILTER (WHERE route.route IS NOT NULL),
        '[]'::json
      ) AS routes
    FROM patch_watch_runs AS run
    LEFT JOIN patch_watch_run_routes AS route ON route.run_id = run.id
    WHERE ${!failuresOnly} OR run.status IN ('partial_failure', 'failed')
    GROUP BY run.id
    ORDER BY run.started_at DESC
    LIMIT ${HISTORY_PAGE_SIZE + 1}
    OFFSET ${offset}
  `)

  const hasMore = rows.length > HISTORY_PAGE_SIZE
  const entries: PatchWatcherHistoryEntry[] = rows.slice(0, HISTORY_PAGE_SIZE).map(row => ({
    ...toRunSummary(row),
    routes: row.routes.map(route => ({
      route: route.route,
      status: route.status,
      revision: route.revision,
      durationMs: route.durationMs === null ? null : Number(route.durationMs),
      errorMessage: route.errorMessage,
      message: getRouteMessage(route.status)
    }))
  }))

  return {
    fetchedAt: new Date().toISOString(),
    page,
    pageSize: HISTORY_PAGE_SIZE,
    hasMore,
    entries
  }
}
