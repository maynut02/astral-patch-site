import type { ModCommitResponse, ModDeleteResponse, ModDetailResponse, ModEntry, ModListEntry, ModListResponse, ModPlatform, ModReleasePageResponse, ModSaveInput } from '#shared/types/mod'
import { MOD_PLATFORMS } from '#shared/types/mod'
import { createError } from 'h3'
import type { DatabaseClient } from './database'
import { getDatabase } from './database'
import { getModGitHubAbout, getModGitHubCommits, getModGitHubReleases, getModGitHubSnapshot, normalizeModRepository, parseModBranch } from './mod-github'
import { isRateLimited } from './rate-limiter'
import { getTextLength } from './validation'

export const MOD_LIST_LIMIT = 200
const MOD_ABOUT_CONCURRENCY = 6
const MAX_MOD_ID = '9223372036854775807'

const MOD_MUTATION_RATE_LIMITS = [
  { name: 'minute', limit: 10, windowMs: 60_000 },
  { name: 'hour', limit: 60, windowMs: 3_600_000 }
] as const

const MOD_REQUEST_ERROR_MESSAGES = new Map([
  ['Authentication is required', '모드를 변경하려면 로그인이 필요합니다.'],
  ['Invalid request body length', '요청 본문의 길이가 올바르지 않습니다.'],
  ['Request body is too large', '요청 본문이 너무 큽니다.'],
  ['JSON request body is required', '모드 정보를 JSON 형식으로 전송해 주세요.'],
  ['Request body must be a JSON object', '모드 정보를 JSON 객체로 입력해 주세요.'],
  ['Cross-origin request is not allowed', '같은 사이트에서 모드 변경을 요청해 주세요.'],
  ['Invalid request origin', '요청 출처가 올바르지 않습니다.'],
  ['Bad Request', '올바른 JSON 요청을 전송해 주세요.']
])

export function rethrowModRequestError(error: unknown): never {
  if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number'
    && 'statusMessage' in error && typeof error.statusMessage === 'string') {
    const statusMessage = MOD_REQUEST_ERROR_MESSAGES.get(error.statusMessage)
    if (statusMessage) {
      throw createError({ statusCode: error.statusCode, statusMessage })
    }
  }
  throw error
}

type ModRow = Omit<ModEntry, 'createdAt' | 'updatedAt' | 'canDelete'> & {
  createdAt: Date | string
  updatedAt: Date | string
}

export function parseModId(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || !/^[1-9][0-9]{0,18}$/.test(value)
    || (value.length === MAX_MOD_ID.length && value > MAX_MOD_ID)) {
    throw createError({ statusCode: 400, statusMessage: '올바른 모드 ID가 아닙니다.' })
  }
  return value
}

function parseText(value: unknown, label: string, maxLength: number, required = false): string {
  if (!required && (value === undefined || value === null)) {
    return ''
  }

  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${label}을(를) 문자열로 입력해 주세요.` })
  }

  const text = value.trim()
  if (required && !text) {
    throw createError({ statusCode: 400, statusMessage: `${label}을(를) 입력해 주세요.` })
  }
  if (text.includes('\0') || getTextLength(text) > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${label}은(는) ${maxLength}자 이하의 올바른 텍스트여야 합니다.` })
  }

  return text
}

export function parseModSaveInput(value: unknown, current?: ModEntry): ModSaveInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: '모드 정보를 JSON 객체로 입력해 주세요.' })
  }

  const input = value as Record<string, unknown>
  const platforms = input.platforms === undefined ? current?.platforms : input.platforms
  if (!Array.isArray(platforms) || platforms.length === 0
    || !platforms.every(platform => MOD_PLATFORMS.includes(platform as ModPlatform))) {
    throw createError({ statusCode: 400, statusMessage: '지원 플랫폼은 Windows 또는 Android 중 하나 이상 선택해 주세요.' })
  }

  return {
    name: parseText(input.name === undefined ? current?.name : input.name, '모드 이름', 120, true),
    summary: parseText(input.summary === undefined ? current?.summary : input.summary, '모드 요약', 300),
    description: parseText(input.description === undefined ? current?.description : input.description, '모드 설명', 20_000),
    repository: normalizeModRepository(input.repository === undefined ? current?.repository : input.repository),
    platforms: MOD_PLATFORMS.filter(platform => platforms.includes(platform))
  }
}

function toMod(row: ModRow): ModEntry {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    description: row.description,
    repository: row.repository,
    platforms: row.platforms,
    authorHandle: row.authorHandle,
    authorRole: row.authorRole,
    isOwner: row.isOwner,
    canEdit: row.canEdit,
    canDelete: row.canEdit,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
  }
}

async function findMod(database: DatabaseClient, modId: string, viewerId: string | null): Promise<ModEntry | null> {
  const [row] = await database<ModRow[]>`
    SELECT
      m.id, m.name, m.summary, m.description, m.repository, m.platforms,
      NULLIF(BTRIM(author.handle), '') AS "authorHandle",
      author."role" AS "authorRole",
      COALESCE(m.created_by = viewer.google_sub, false) AS "isOwner",
      COALESCE(m.created_by = viewer.google_sub OR viewer."role" = 'admin', false) AS "canEdit",
      m.created_at AS "createdAt", m.updated_at AS "updatedAt"
    FROM mods m
    JOIN app_users author ON author.google_sub = m.created_by
    LEFT JOIN app_users viewer ON viewer.google_sub = ${viewerId}
    WHERE m.id = ${modId}
  `

  return row ? toMod(row) : null
}

async function requireMod(database: DatabaseClient, modId: string, viewerId: string | null): Promise<ModEntry> {
  const mod = await findMod(database, modId, viewerId)
  if (!mod) {
    throw createError({ statusCode: 404, statusMessage: '모드를 찾을 수 없습니다.' })
  }
  return mod
}

async function assertMutationRateLimit(database: DatabaseClient, userId: string): Promise<void> {
  if (await isRateLimited(database, `mod-mutation:${userId}`, MOD_MUTATION_RATE_LIMITS)) {
    throw createError({ statusCode: 429, statusMessage: '모드 변경 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' })
  }
}

function rethrowSaveError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
    throw createError({ statusCode: 409, statusMessage: '이미 등록된 GitHub 저장소입니다.' })
  }
  throw error
}

export async function getMods(viewerId: string | null = null): Promise<ModListResponse> {
  const database = getDatabase()
  const rows = await database<ModRow[]>`
    SELECT
      m.id, m.name, m.summary, m.description, m.repository, m.platforms,
      NULLIF(BTRIM(author.handle), '') AS "authorHandle",
      author."role" AS "authorRole",
      COALESCE(m.created_by = viewer.google_sub, false) AS "isOwner",
      COALESCE(m.created_by = viewer.google_sub OR viewer."role" = 'admin', false) AS "canEdit",
      m.created_at AS "createdAt", m.updated_at AS "updatedAt"
    FROM mods m
    JOIN app_users author ON author.google_sub = m.created_by
    LEFT JOIN app_users viewer ON viewer.google_sub = ${viewerId}
    ORDER BY m.updated_at DESC, m.id DESC
    LIMIT ${MOD_LIST_LIMIT}
  `

  const mods: ModListEntry[] = rows.map(row => ({ ...toMod(row), githubDescription: '' }))
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(MOD_ABOUT_CONCURRENCY, mods.length) }, async () => {
    while (nextIndex < mods.length) {
      const mod = mods[nextIndex++]
      if (!mod) return
      try {
        mod.githubDescription = await getModGitHubAbout(mod.repository)
      } catch {
        mod.githubDescription = ''
      }
    }
  }))

  return { mods }
}

export async function getModDetail(modIdValue: unknown, viewerId: string | null = null): Promise<ModDetailResponse> {
  const modId = parseModId(modIdValue)
  const mod = await requireMod(getDatabase(), modId, viewerId)
  try {
    const github = await getModGitHubSnapshot(mod.repository)
    return { mod, github, githubError: null }
  } catch (error) {
    const githubError = error && typeof error === 'object' && 'statusMessage' in error
      && typeof error.statusMessage === 'string' && error.statusMessage.trim()
      ? error.statusMessage
      : 'GitHub 저장소 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
    return { mod, github: null, githubError }
  }
}

export async function getModCommits(modIdValue: unknown, branchValue: unknown): Promise<ModCommitResponse> {
  const modId = parseModId(modIdValue)
  const branch = branchValue === undefined ? undefined : parseModBranch(branchValue)
  const [mod] = await getDatabase()<{ repository: string }[]>`
    SELECT repository FROM mods WHERE id = ${modId}
  `
  if (!mod) {
    throw createError({ statusCode: 404, statusMessage: '모드를 찾을 수 없습니다.' })
  }
  return getModGitHubCommits(mod.repository, branch)
}

export async function getModReleases(modIdValue: unknown, pageValue: unknown): Promise<ModReleasePageResponse> {
  const modId = parseModId(modIdValue)
  const page = pageValue === undefined ? 1 : Number(pageValue)
  if ((pageValue !== undefined && (typeof pageValue !== 'string' || !/^[1-9][0-9]*$/.test(pageValue)))
    || !Number.isSafeInteger(page) || page < 1 || page > 1000) {
    throw createError({ statusCode: 400, statusMessage: '릴리스 페이지는 1부터 1000 사이의 정수여야 합니다.' })
  }

  const [mod] = await getDatabase()<{ repository: string }[]>`
    SELECT repository FROM mods WHERE id = ${modId}
  `
  if (!mod) {
    throw createError({ statusCode: 404, statusMessage: '모드를 찾을 수 없습니다.' })
  }

  return getModGitHubReleases(mod.repository, page)
}

export async function createMod(userId: string, inputValue: unknown): Promise<ModEntry> {
  const input = parseModSaveInput(inputValue)
  const database = getDatabase()
  await assertMutationRateLimit(database, userId)
  const github = await getModGitHubSnapshot(input.repository)
  const repository = normalizeModRepository(github.repository)
  let modId: string

  try {
    const [created] = await database<{ id: string }[]>`
      INSERT INTO mods (name, summary, description, repository, platforms, created_by)
      VALUES (${input.name}, ${input.summary}, ${input.description}, ${repository},
        ${database.array(input.platforms)}::text[], ${userId})
      RETURNING id
    `
    if (!created) {
      throw createError({ statusCode: 500, statusMessage: '모드를 등록하지 못했습니다.' })
    }
    modId = created.id
  } catch (error) {
    rethrowSaveError(error)
  }

  return requireMod(database, modId, userId)
}

export async function updateMod(userId: string, modIdValue: unknown, inputValue: unknown): Promise<ModEntry> {
  const modId = parseModId(modIdValue)
  const database = getDatabase()
  const current = await requireMod(database, modId, userId)
  if (!current.canEdit) {
    throw createError({ statusCode: 403, statusMessage: '모드는 등록자나 관리자만 수정할 수 있습니다.' })
  }

  const input = parseModSaveInput(inputValue, current)
  await assertMutationRateLimit(database, userId)
  let repository = current.repository
  if (input.repository.toLowerCase() !== current.repository.toLowerCase()) {
    const github = await getModGitHubSnapshot(input.repository)
    repository = normalizeModRepository(github.repository)
  }

  try {
    const [updated] = await database<{ id: string }[]>`
      UPDATE mods AS m
      SET name = ${input.name}, summary = ${input.summary}, description = ${input.description},
        repository = ${repository}, platforms = ${database.array(input.platforms)}::text[], updated_at = now()
      WHERE m.id = ${modId} AND EXISTS (
        SELECT 1 FROM app_users actor
        WHERE actor.google_sub = ${userId}
          AND (m.created_by = actor.google_sub OR actor."role" = 'admin')
      )
      RETURNING m.id
    `
    if (!updated) {
      throw createError({ statusCode: 403, statusMessage: '모드는 등록자나 관리자만 수정할 수 있습니다.' })
    }
  } catch (error) {
    rethrowSaveError(error)
  }

  return requireMod(database, modId, userId)
}

export async function deleteMod(userId: string, modIdValue: unknown): Promise<ModDeleteResponse> {
  const modId = parseModId(modIdValue)
  const database = getDatabase()
  const current = await requireMod(database, modId, userId)
  if (!current.canDelete) {
    throw createError({ statusCode: 403, statusMessage: '모드는 등록자나 관리자만 삭제할 수 있습니다.' })
  }
  await assertMutationRateLimit(database, userId)
  const [deleted] = await database<{ id: string }[]>`
    DELETE FROM mods AS m
    WHERE m.id = ${modId} AND EXISTS (
      SELECT 1 FROM app_users actor
      WHERE actor.google_sub = ${userId}
        AND (m.created_by = actor.google_sub OR actor."role" = 'admin')
    )
    RETURNING m.id
  `
  if (!deleted) {
    throw createError({ statusCode: 403, statusMessage: '모드는 등록자나 관리자만 삭제할 수 있습니다.' })
  }
  return { id: deleted.id, deleted: true }
}
