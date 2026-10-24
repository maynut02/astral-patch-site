import type { ModCommitResponse, ModDeleteResponse, ModDetailResponse, ModEntry, ModListEntry, ModListResponse, ModPlatform, ModReleasePageResponse, ModSaveInput } from '#shared/types/mod'
import { MOD_PLATFORMS } from '#shared/types/mod'
import { createError } from 'h3'
import type { DatabaseClient } from './database'
import { getDatabase } from './database'
import { getModGitHubAbout, getModGitHubCommits, getModGitHubReleases, getModGitHubSnapshot, normalizeModRepository, parseModBranch } from './mod-github'
import { assertModMutationRateLimit } from './mod-rate-limit'
import { parseText } from './validation'
import { getRequestErrorCode } from './request-security'

export const MOD_LIST_LIMIT = 200
const MOD_ABOUT_CONCURRENCY = 6
// mods.id는 PostgreSQL bigint이며 정밀도 손실 없이 문자열로 전송한다.
const MAX_MOD_ID = '9223372036854775807'

const MOD_REQUEST_ERROR_MESSAGES = new Map([
  ['Authentication is required', '모드를 변경하려면 로그인이 필요합니다.'],
  ['INVALID_BODY_LENGTH', '요청 본문의 길이가 올바르지 않습니다.'],
  ['BODY_TOO_LARGE', '요청 본문이 너무 큽니다.'],
  ['JSON_REQUIRED', '모드 정보를 JSON 형식으로 전송해 주세요.'],
  ['OBJECT_REQUIRED', '모드 정보를 JSON 객체로 입력해 주세요.'],
  ['CROSS_ORIGIN', '같은 사이트에서 모드 변경을 요청해 주세요.'],
  ['INVALID_ORIGIN', '요청 출처가 올바르지 않습니다.'],
  ['Bad Request', '올바른 JSON 요청을 전송해 주세요.']
])

export function rethrowModRequestError(error: unknown): never {
  if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number'
    && 'statusMessage' in error && typeof error.statusMessage === 'string') {
    const statusMessage = MOD_REQUEST_ERROR_MESSAGES.get(getRequestErrorCode(error) ?? error.statusMessage)
    if (statusMessage) {
      throw createError({ statusCode: error.statusCode, statusMessage })
    }
  }
  throw error
}

type ModRow = Omit<ModEntry, 'createdAt' | 'updatedAt' | 'canDelete'> & {
  createdAt: Date
  updatedAt: Date
}

export function parseModId(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || !/^[1-9][0-9]{0,18}$/.test(value)
    || (value.length === MAX_MOD_ID.length && value > MAX_MOD_ID)) {
    throw createError({ statusCode: 400, statusMessage: '올바른 모드 ID가 아닙니다.' })
  }
  return value
}

function parseModText(value: unknown, label: string, maxLength: number, required = false): string {
  return parseText(value, {
    field: label,
    maxLength,
    required,
    rejectNul: true,
    typeMessage: `${label}을(를) 문자열로 입력해 주세요.`,
    emptyMessage: `${label}을(를) 입력해 주세요.`,
    lengthMessage: `${label}은(는) ${maxLength}자 이하의 올바른 텍스트여야 합니다.`
  })
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
    name: parseModText(input.name === undefined ? current?.name : input.name, '모드 이름', 120, true),
    summary: parseModText(input.summary === undefined ? current?.summary : input.summary, '모드 요약', 300),
    description: parseModText(input.description === undefined ? current?.description : input.description, '모드 설명', 20_000),
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
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

async function requireModRepository(database: DatabaseClient, modId: string): Promise<string> {
  const [mod] = await database<{ repository: string }[]>`
    SELECT repository FROM mods WHERE id = ${modId}
  `
  if (!mod) {
    throw createError({ statusCode: 404, statusMessage: '모드를 찾을 수 없습니다.' })
  }
  return mod.repository
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
  const repositoryMods = new Map<string, ModListEntry[]>()
  for (const mod of mods) {
    try {
      const repository = normalizeModRepository(mod.repository)
      const entries = repositoryMods.get(repository)
      if (entries) entries.push(mod)
      else repositoryMods.set(repository, [mod])
    } catch {
      // 기존과 같이 유효하지 않거나 조회에 실패한 저장소의 About은 비워 둔다.
    }
  }
  const repositories = [...repositoryMods.entries()]
  let nextIndex = 0
  // GitHub 유틸의 기존 타임아웃·재시도·마지막 성공값 캐시를 그대로 사용한다.
  await Promise.all(Array.from({ length: Math.min(MOD_ABOUT_CONCURRENCY, repositories.length) }, async () => {
    while (nextIndex < repositories.length) {
      const entry = repositories[nextIndex++]
      if (!entry) return
      const [repository, entries] = entry
      try {
        const description = await getModGitHubAbout(repository)
        for (const mod of entries) mod.githubDescription = description
      } catch {
        // 한 저장소의 실패가 나머지 목록을 중단하지 않는다.
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
  const repository = await requireModRepository(getDatabase(), modId)
  return getModGitHubCommits(repository, branch)
}

export async function getModReleases(modIdValue: unknown, pageValue: unknown): Promise<ModReleasePageResponse> {
  const modId = parseModId(modIdValue)
  const page = pageValue === undefined ? 1 : Number(pageValue)
  if ((pageValue !== undefined && (typeof pageValue !== 'string' || !/^[1-9][0-9]*$/.test(pageValue)))
    || !Number.isSafeInteger(page) || page < 1 || page > 1000) {
    throw createError({ statusCode: 400, statusMessage: '릴리스 페이지는 1부터 1000 사이의 정수여야 합니다.' })
  }

  const repository = await requireModRepository(getDatabase(), modId)
  return getModGitHubReleases(repository, page)
}

export async function createMod(userId: string, inputValue: unknown): Promise<ModEntry> {
  const input = parseModSaveInput(inputValue)
  const database = getDatabase()
  await assertModMutationRateLimit(userId)
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
  await assertModMutationRateLimit(userId)
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
  await assertModMutationRateLimit(userId)
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
