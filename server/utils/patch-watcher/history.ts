import type { PatchWatcherHistoryEntry, PatchWatcherHistoryResponse } from '#shared/types/status'
import { withDatabaseRetry } from '../database'
import { HISTORY_PAGE_SIZE, getRouteMessage, toRunSummary, type HistoryRunRow } from './presentation'

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
            WHEN 'INT_IOS' THEN 5
            ELSE 6
          END
        ) FILTER (WHERE route.route IS NOT NULL),
        '[]'::json
      ) AS routes
    FROM patch_watch_runs AS run
    LEFT JOIN patch_watch_run_routes AS route
      ON route.run_id = run.id
      AND route.route <> 'INT_IOS'
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
