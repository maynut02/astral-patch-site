import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createError } from 'h3'
import type {
  AdminTranslationPackPublication,
  AdminTranslationPackStatus
} from '#shared/types/admin'
import type { CurrentSessionUser } from './auth-user'
import { getDatabase, type DatabaseClient } from './database'
import { deleteR2Object, getTranslationPackBucketConfig, putR2Object, type R2BucketConfig } from './r2'

// Runtime translation pack consumed by the Korean plugin. Every route reads the INT_STEAM
// translation units, so one pack serves all routes; the plugin picks the target lang asset
// and STR field per route. See astral-party-korean-plugin docs/runtime-translation-and-font-prototype.md.
const PACK_LOCALE = 'ko'
const PACK_SCHEMA_VERSION = 1
const SOURCE_ROUTE = 'INT_STEAM'
const OBJECT_PREFIX = 'translation-pack'
const POINTER_KEY = `${OBJECT_PREFIX}/latest.json`
const RETAIN_RECENT_COUNT = 10
// Arbitrary constant that only this module uses for pg_try_advisory_xact_lock.
const PUBLISH_LOCK_KEY = 2026102201

interface PublicationRow {
  number: number
  gameVersion: string
  revision: string
  publishedAt: Date
  publishedBy: string | null
  gzipByteSize: number
  langCount: number
  strCount: number
}

interface GameRevisionRow {
  gameVersion: string
  revision: string
}

interface TranslationRow {
  kind: 'lang' | 'str'
  namespace: string
  unitKey: string
  text: string
}

function toPublication(row: PublicationRow): AdminTranslationPackPublication {
  return { ...row, publishedAt: row.publishedAt.toISOString() }
}

async function getCurrentGameRevision(database: DatabaseClient): Promise<GameRevisionRow | null> {
  const [row] = await database<GameRevisionRow[]>`
    SELECT game_version AS "gameVersion", revision
    FROM game_revisions
    WHERE route = ${SOURCE_ROUTE}
      AND processed_at IS NOT NULL
    ORDER BY detected_at DESC
    LIMIT 1
  `
  return row ?? null
}

async function getLatestPublication(database: DatabaseClient): Promise<PublicationRow | null> {
  const [row] = await database<PublicationRow[]>`
    SELECT
      p.number,
      p.game_version AS "gameVersion",
      p.revision,
      p.published_at AS "publishedAt",
      u.handle AS "publishedBy",
      p.gzip_byte_size AS "gzipByteSize",
      p.lang_count AS "langCount",
      p.str_count AS "strCount"
    FROM translation_pack_publications p
    LEFT JOIN app_users u ON u.google_sub = p.published_by
    ORDER BY p.number DESC
    LIMIT 1
  `
  return row ?? null
}

export async function getTranslationPackStatus(): Promise<AdminTranslationPackStatus> {
  const database = getDatabase()
  const [latest, currentGame] = await Promise.all([
    getLatestPublication(database),
    getCurrentGameRevision(database)
  ])
  const since = latest?.publishedAt
  const [pending] = since
    ? await database<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM translations
        WHERE locale = ${PACK_LOCALE} AND updated_at > ${since}
      `
    : await database<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM translations
        WHERE locale = ${PACK_LOCALE}
      `

  return {
    latest: latest ? toPublication(latest) : null,
    pendingChangeCount: pending?.count ?? 0,
    currentGame
  }
}

function buildPackBody(rows: TranslationRow[]) {
  const lang: Record<string, string> = {}
  const str: Record<string, Record<string, string>> = {}

  for (const row of rows) {
    // The game assets use LF; reviewers may paste CRLF.
    const text = row.text.replace(/\r\n?/g, '\n')

    if (row.kind === 'lang') {
      lang[row.unitKey] = text
    } else {
      (str[row.namespace] ??= {})[row.unitKey] = text
    }
  }

  return { lang, str }
}

async function deleteRetiredPacks(database: DatabaseClient, config: R2BucketConfig): Promise<void> {
  // Keep the newest packs plus the last pack of every game version/revision.
  const retired = await database<{ number: number, objectKey: string }[]>`
    SELECT number, object_key AS "objectKey"
    FROM translation_pack_publications
    WHERE object_deleted_at IS NULL
      AND number NOT IN (
        SELECT number FROM translation_pack_publications ORDER BY number DESC LIMIT ${RETAIN_RECENT_COUNT}
      )
      AND number NOT IN (
        SELECT max(number) FROM translation_pack_publications GROUP BY game_version, revision
      )
    ORDER BY number
  `

  for (const pack of retired) {
    try {
      await deleteR2Object(config, pack.objectKey)
      await database`
        UPDATE translation_pack_publications
        SET object_deleted_at = now()
        WHERE number = ${pack.number}
      `
    } catch (error: unknown) {
      // Left with object_deleted_at NULL, so the next publish retries it.
      console.error(`[translation-pack] failed to delete retired pack ${pack.objectKey}`, error)
    }
  }
}

export async function publishTranslationPack(publisher: CurrentSessionUser): Promise<AdminTranslationPackPublication> {
  const config = getTranslationPackBucketConfig()
  const database = getDatabase()
  const game = await getCurrentGameRevision(database)

  if (!game) {
    throw createError({
      statusCode: 409,
      statusMessage: `No processed ${SOURCE_ROUTE} game revision exists`
    })
  }

  const publication = await database.begin(async (transaction): Promise<AdminTranslationPackPublication> => {
    const [lock] = await transaction<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${PUBLISH_LOCK_KEY}) AS acquired
    `

    if (!lock?.acquired) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Another translation pack publish is in progress'
      })
    }

    const rows = await transaction<TranslationRow[]>`
      SELECT tu.kind, tu.namespace, tu.unit_key AS "unitKey", tr.text
      FROM translations tr
      JOIN translation_units tu ON tu.id = tr.unit_id
      WHERE tr.locale = ${PACK_LOCALE}
      ORDER BY tu.kind, tu.namespace, tu.unit_key
    `
    // nextval is not rolled back, so a failed attempt never hands its number to a later pack.
    const [sequence] = await transaction<{ number: number }[]>`
      SELECT nextval('translation_pack_number_seq')::int AS number
    `

    if (!sequence) {
      throw createError({ statusCode: 500, statusMessage: 'Translation pack number could not be allocated' })
    }

    const number = sequence.number
    const publishedAt = new Date(Math.floor(Date.now() / 1000) * 1000)
    const publishedAtText = publishedAt.toISOString().replace('.000Z', 'Z')
    const body = buildPackBody(rows)
    const json = Buffer.from(JSON.stringify({
      schemaVersion: PACK_SCHEMA_VERSION,
      locale: PACK_LOCALE,
      pack: { number, version: game.gameVersion, revision: game.revision, publishedAt: publishedAtText },
      ...body
    }), 'utf8')
    const gzip = gzipSync(json, { level: 9 })
    const gzipSha256 = createHash('sha256').update(gzip).digest('hex')
    const packPath = `packs/${number}.json.gz`
    const objectKey = `${OBJECT_PREFIX}/${packPath}`
    const langCount = Object.keys(body.lang).length
    const strCount = Object.values(body.str).reduce((total, entries) => total + Object.keys(entries).length, 0)

    await transaction`
      INSERT INTO translation_pack_publications (
        number, game_version, revision, object_key, byte_size, gzip_byte_size,
        gzip_sha256, lang_count, str_count, published_by, published_at
      )
      VALUES (
        ${number}, ${game.gameVersion}, ${game.revision}, ${objectKey}, ${json.byteLength}, ${gzip.byteLength},
        ${gzipSha256}, ${langCount}, ${strCount}, ${publisher.id}, ${publishedAt}
      )
    `

    // Pack objects are immutable (numbers are never reused), so the CDN may cache them forever.
    // A failure below rolls the row back and may leave an unreferenced pack object; it is not
    // deleted here because an ambiguous pointer PUT may already reference it.
    await putR2Object(config, objectKey, gzip, {
      contentType: 'application/gzip',
      cacheControl: 'public, max-age=31536000, immutable'
    })

    // The advisory lock lives on this transaction's connection. Confirm it is still held right
    // before activation, so an attempt whose connection dropped cannot overwrite a newer pointer.
    await transaction`SELECT 1`

    // The pointer goes last; until it lands, clients keep resolving the previous pack.
    const pointer = Buffer.from(JSON.stringify({
      schemaVersion: PACK_SCHEMA_VERSION,
      locale: PACK_LOCALE,
      number,
      version: game.gameVersion,
      revision: game.revision,
      publishedAt: publishedAtText,
      path: packPath,
      size: gzip.byteLength,
      sha256: gzipSha256
    }), 'utf8')
    await putR2Object(config, POINTER_KEY, pointer, {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'no-cache'
    })

    return {
      number,
      gameVersion: game.gameVersion,
      revision: game.revision,
      publishedAt: publishedAt.toISOString(),
      publishedBy: publisher.handle,
      gzipByteSize: gzip.byteLength,
      langCount,
      strCount
    }
  })

  // Retention runs after the response so slow deletes cannot push the request past the proxy
  // timeout; a failed or interrupted cleanup is retried by the next publish.
  void deleteRetiredPacks(database, config).catch((error: unknown) => {
    console.error('[translation-pack] retention cleanup failed', error)
  })

  return publication
}
