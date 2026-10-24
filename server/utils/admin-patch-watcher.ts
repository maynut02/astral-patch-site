import { createError } from 'h3'
import type { AdminPatchWatcherConfig } from '#shared/types/admin'
import { getDatabase } from './database'
import { parseText } from './validation'

interface AdminPatchWatcherConfigRow {
  gameVersion: string
  enabled: boolean
  updatedAt: Date
}

const GAME_VERSION_PATTERN = /^\d+\.\d+\.\d+$/

function toAdminPatchWatcherConfig(row: AdminPatchWatcherConfigRow): AdminPatchWatcherConfig {
  return {
    gameVersion: row.gameVersion,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString()
  }
}

function normalizeGameVersion(value: unknown): string {
  const gameVersion = parseText(value, {
    field: 'Game version',
    required: true,
    emptyMessage: 'Game version must use x.y.z format'
  })

  if (!GAME_VERSION_PATTERN.test(gameVersion)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Game version must use x.y.z format'
    })
  }

  return gameVersion
}

export async function getAdminPatchWatcherConfig(): Promise<AdminPatchWatcherConfig> {
  const database = getDatabase()
  const [row] = await database<AdminPatchWatcherConfigRow[]>`
    SELECT
      game_version AS "gameVersion",
      enabled,
      updated_at AS "updatedAt"
    FROM patch_watch_config
    WHERE singleton = true
  `

  if (!row) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Patch watcher configuration is missing'
    })
  }

  return toAdminPatchWatcherConfig(row)
}

export async function updateAdminPatchWatcherGameVersion(value: unknown): Promise<AdminPatchWatcherConfig> {
  const gameVersion = normalizeGameVersion(value)
  const database = getDatabase()
  const [updated] = await database<AdminPatchWatcherConfigRow[]>`
    UPDATE patch_watch_config
    SET
      game_version = ${gameVersion},
      updated_at = now()
    WHERE singleton = true
    RETURNING
      game_version AS "gameVersion",
      enabled,
      updated_at AS "updatedAt"
  `

  if (!updated) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Patch watcher configuration is missing'
    })
  }

  return toAdminPatchWatcherConfig(updated)
}
