import { createError } from 'h3'
import type { PatchWatcherHourlyStat, PatchWatcherRoute, PatchWatcherRouteSummary, PatchWatcherStatusResponse } from '#shared/types/status'
import { withDatabaseRetry } from '../database'
import {
  ROUTES, WATCH_INTERVAL_MINUTES, DELAYED_AFTER_MINUTES, OUTAGE_AFTER_MINUTES,
  getOverallState, getRouteMessage, toHourlyStat, toIso, toRunSummary,
  type WatcherConfigRow, type WatchRunRow, type RouteStateRow, type HourlyStatRow
} from './presentation'

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
      WHERE state.route <> 'INT_IOS'
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
    throw createError({ statusCode: 500, statusMessage: 'Patch watcher configuration is missing' })
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
