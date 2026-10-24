import { Buffer } from 'node:buffer'
import { createError } from 'h3'
import type { ModCommit, ModCommitResponse, ModGitHubSnapshot, ModReleasePageResponse } from '#shared/types/mod'
import type { ReleaseAssetInfo, ReleaseNoteEntry } from '#shared/types/releases'
import { getGitHubErrorDetails as getErrorDetails, toGitHubError } from './github/errors'
import { asNumber, asString, isRecord } from './github/normalizers'

const RELEASE_PAGE_SIZE = 20
const CACHE_MAX_AGE = 5 * 60
const README_MAX_LENGTH = 100_000

export function normalizeModRepository(value: unknown): string {
  // 원문을 검사해 경로 탐색, 인증 정보, 이스케이프 구분자, 포트와 다른 호스트를 차단한다.
  const match = typeof value === 'string' && !/\p{Cc}/u.test(value)
    ? /^(?:https:\/\/github\.com\/)?([a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38})\/([a-z0-9._-]{1,104})\/?$/i.exec(value.trim())
    : null
  const owner = match?.[1] ?? ''
  const repo = (match?.[2] ?? '').replace(/\.git$/i, '')

  if (!owner || !repo || repo.length > 100 || repo === '.' || repo === '..') {
    throw createError({
      statusCode: 400,
      statusMessage: 'GitHub 저장소는 owner/repo 또는 https://github.com/owner/repo 형식으로 입력해 주세요.'
    })
  }

  return `${owner}/${repo}`.toLowerCase()
}

export function parseModBranch(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || value === '@'
    || /[~^:?*\\]/.test(value) || value.includes('[') || value.startsWith('-')
    || [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
    || value.startsWith('/') || value.endsWith('/') || value.endsWith('.')
    || value.includes('..') || value.includes('@{') || value.includes('//')
    || value.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) {
    throw createError({ statusCode: 400, statusMessage: '올바른 브랜치 이름을 입력해 주세요.' })
  }
  return value
}

function getGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'astral-patch-site',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  const token = String(process.env.GITHUB_TOKEN || '').trim()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function fetchGitHub(repository: string, endpoint = '', query: Record<string, string | number> = {}) {
  // 고정된 GitHub REST 주소만 조회하고 리다이렉트와 반환된 다운로드 주소로 토큰을 전송하지 않는다.
  return $fetch.raw<unknown>(`https://api.github.com/repos/${repository}${endpoint}`, {
    query,
    headers: getGitHubHeaders(),
    redirect: 'error',
    timeout: 10_000,
    retry: 1,
    retryDelay: 250,
    retryStatusCodes: [408, 500, 502, 503, 504]
  })
}

async function fetchPublicRepository(repository: string): Promise<Record<string, unknown>> {
  let data: unknown
  try {
    data = (await fetchGitHub(repository))._data
  } catch (error) {
    throw toGitHubError(error)
  }

  if (!isRecord(data) || typeof data.private !== 'boolean') {
    throw toGitHubError(null)
  }
  // 토큰으로 비공개 저장소도 조회할 수 있으므로 인증 성공 후에도 공개 여부를 확인한다.
  if (data.private || (data.visibility !== undefined && data.visibility !== 'public')) {
    throw createError({ statusCode: 403, statusMessage: '공개 GitHub 저장소만 사용할 수 있습니다.' })
  }
  return data
}

async function fetchReadme(repository: string, defaultBranch: string): Promise<ModGitHubSnapshot['readme']> {
  let data: unknown
  try {
    data = (await fetchGitHub(repository, '/readme', defaultBranch ? { ref: defaultBranch } : {}))._data
  } catch (error) {
    if (getErrorDetails(error).status === 404) return null
    throw error
  }
  if (!isRecord(data) || data.encoding !== 'base64' || typeof data.content !== 'string' || !asString(data.path)) {
    throw new Error('Invalid GitHub README response')
  }
  const content = data.content.replace(/\s/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
    throw new Error('Invalid GitHub README encoding')
  }
  return {
    content: Buffer.from(content, 'base64').toString('utf8'),
    path: asString(data.path),
    url: asString(data.html_url)
  }
}

function normalizeCommit(value: unknown): ModCommit | null {
  if (!isRecord(value) || !isRecord(value.commit)) return null
  const sha = asString(value.sha)
  const url = asString(value.html_url)
  if (!sha || !url) return null
  const author = isRecord(value.commit.author) ? value.commit.author : {}
  const committer = isRecord(value.commit.committer) ? value.commit.committer : {}
  const account = isRecord(value.author) ? value.author : {}
  return {
    sha,
    message: asString(value.commit.message),
    author: asString(author.name) || asString(account.login) || asString(committer.name),
    date: asString(author.date) || asString(committer.date),
    url
  }
}

async function fetchBranches(repository: string): Promise<string[]> {
  const branches = new Set<string>()
  for (let page = 1; ; page++) {
    const response = await fetchGitHub(repository, '/branches', { per_page: 100, page })
    if (!Array.isArray(response._data)) throw new Error('Invalid GitHub branches response')
    for (const branch of response._data) {
      if (isRecord(branch) && asString(branch.name)) branches.add(asString(branch.name))
    }
    // Only inspect pagination; all requests stay on our fixed GitHub API URL.
    if (!response._data.length || !/;\s*rel="next"/.test(response.headers.get('link') || '')) {
      return [...branches]
    }
  }
}

async function fetchCommits(repository: string, branch: string): Promise<ModCommit[]> {
  let data: unknown
  try {
    data = (await fetchGitHub(repository, '/commits', {
      per_page: 10,
      ...(branch ? { sha: branch } : {})
    }))._data
  } catch (error) {
    // 빈 저장소의 커밋 목록에 대한 GitHub의 409 응답은 빈 목록으로 처리한다.
    if (getErrorDetails(error).status === 409) return []
    throw error
  }
  if (!Array.isArray(data)) throw new Error('Invalid GitHub commits response')
  return data.slice(0, 10).map(normalizeCommit).filter((commit): commit is ModCommit => commit !== null)
}

function normalizeAsset(value: unknown): ReleaseAssetInfo | null {
  if (!isRecord(value) || !asString(value.name) || !asString(value.browser_download_url)) return null
  return {
    id: asNumber(value.id),
    name: asString(value.name),
    contentType: asString(value.content_type),
    size: asNumber(value.size),
    downloadCount: asNumber(value.download_count),
    createdAt: asString(value.created_at),
    updatedAt: asString(value.updated_at),
    downloadUrl: asString(value.browser_download_url)
  }
}

function normalizeRelease(value: unknown): ReleaseNoteEntry | null {
  if (!isRecord(value) || value.draft !== false || !asString(value.tag_name) || !asString(value.html_url)) return null
  return {
    id: asNumber(value.id),
    tagName: asString(value.tag_name),
    title: asString(value.name) || asString(value.tag_name),
    body: asString(value.body),
    url: asString(value.html_url),
    prerelease: value.prerelease === true,
    createdAt: asString(value.created_at),
    publishedAt: asString(value.published_at) || asString(value.created_at),
    assets: Array.isArray(value.assets)
      ? value.assets.map(normalizeAsset).filter((asset): asset is ReleaseAssetInfo => asset !== null)
      : []
  }
}

async function fetchReleasePage(repository: string, page: number): Promise<ModReleasePageResponse> {
  const response = await fetchGitHub(repository, '/releases', { per_page: RELEASE_PAGE_SIZE, page })
  if (!Array.isArray(response._data)) throw new Error('Invalid GitHub releases response')
  return {
    releases: response._data.map(normalizeRelease).filter((release): release is ReleaseNoteEntry => release !== null),
    page,
    // Link 헤더의 다음 페이지 여부만 확인하고 헤더에 포함된 주소는 조회하지 않는다.
    hasMore: /;\s*rel="next"/.test(response.headers.get('link') || '')
  }
}

const getCachedAbout = defineCachedFunction(async (repository: string): Promise<string> => {
  const storage = useStorage('cache')
  // Keep the last successful About separately, beyond the five-minute response cache.
  const key = `mod-github-about:last-success:${repository}`
  let description: string
  try {
    const repo = await fetchPublicRepository(repository)
    description = asString(repo.description)
  } catch (error) {
    const status = getErrorDetails(error).status
    if (status === 403 || status === 404) {
      await storage.removeItem(key).catch(() => {})
      return ''
    }
    return asString(await storage.getItem(key).catch(() => null))
  }

  await storage.setItem(key, description).catch(() => {})
  return description
}, {
  name: 'mod-github-about',
  maxAge: CACHE_MAX_AGE,
  swr: false,
  getKey: (repository: string) => repository
})

const getCachedSnapshot = defineCachedFunction(async (repository: string): Promise<ModGitHubSnapshot> => {
  const repo = await fetchPublicRepository(repository)
  const defaultBranch = asString(repo.default_branch)
  const [readme, commits, releases, branches] = await Promise.allSettled([
    fetchReadme(repository, defaultBranch),
    fetchCommits(repository, defaultBranch),
    fetchReleasePage(repository, 1),
    fetchBranches(repository)
  ])
  const warnings: string[] = []
  for (const [label, result] of [
    ['README', readme], ['커밋', commits], ['릴리스', releases], ['브랜치', branches]
  ] as const) {
    if (result.status === 'rejected') warnings.push(`${label}: ${toGitHubError(result.reason).statusMessage}`)
  }
  let snapshotReadme = readme.status === 'fulfilled' ? readme.value : null
  // 디코딩된 본문이 10만 자를 넘으면 브라우저의 Markdown 처리 부담을 줄이도록 제외한다.
  if (snapshotReadme && snapshotReadme.content.length > README_MAX_LENGTH) {
    snapshotReadme = null
    warnings.push('README: 본문이 100,000자를 초과해 표시하지 않습니다. GitHub에서 확인해 주세요.')
  }
  const license = isRecord(repo.license) ? repo.license : {}
  return {
    repository,
    url: `https://github.com/${repository}`,
    description: asString(repo.description),
    defaultBranch,
    branches: [...new Set([...(defaultBranch ? [defaultBranch] : []), ...(branches.status === 'fulfilled' ? branches.value : [])])],
    stars: asNumber(repo.stargazers_count),
    license: (asString(license.spdx_id) !== 'NOASSERTION' && asString(license.spdx_id)) || asString(license.name) || null,
    archived: repo.archived === true,
    pushedAt: asString(repo.pushed_at) || null,
    readme: snapshotReadme,
    commits: commits.status === 'fulfilled' ? commits.value : [],
    releases: releases.status === 'fulfilled' ? releases.value.releases : [],
    hasMoreReleases: releases.status === 'fulfilled' && releases.value.hasMore,
    fetchedAt: new Date().toISOString(),
    warnings
  }
}, {
  name: 'mod-github-snapshot',
  maxAge: CACHE_MAX_AGE,
  swr: false,
  getKey: (repository: string) => repository
})

const getCachedReleases = defineCachedFunction(async (repository: string, page: number): Promise<ModReleasePageResponse> => {
  await fetchPublicRepository(repository)
  try {
    return await fetchReleasePage(repository, page)
  } catch (error) {
    throw toGitHubError(error)
  }
}, {
  name: 'mod-github-releases',
  maxAge: CACHE_MAX_AGE,
  swr: false,
  getKey: (repository: string, page: number) => `${repository}:${page}`
})

const getCachedCommits = defineCachedFunction(async (repository: string, branch?: string): Promise<ModCommitResponse> => {
  const repo = await fetchPublicRepository(repository)
  const selectedBranch = branch ?? asString(repo.default_branch)
  try {
    return { branch: selectedBranch, commits: await fetchCommits(repository, selectedBranch) }
  } catch (error) {
    if ([404, 422].includes(getErrorDetails(error).status)) {
      throw createError({ statusCode: 404, statusMessage: '브랜치를 찾을 수 없습니다. GitHub 정보를 다시 확인해 주세요.' })
    }
    throw toGitHubError(error)
  }
}, {
  name: 'mod-github-commits',
  maxAge: CACHE_MAX_AGE,
  swr: false,
  getKey: (repository: string, branch?: string) => `${repository}:${branch === undefined ? 'default' : `branch:${encodeURIComponent(branch)}`}`
})

export async function getModGitHubCommits(repository: string, branch?: string): Promise<ModCommitResponse> {
  return getCachedCommits(normalizeModRepository(repository), branch === undefined ? undefined : parseModBranch(branch))
}

export async function getModGitHubAbout(repository: string): Promise<string> {
  return getCachedAbout(normalizeModRepository(repository))
}

export async function getModGitHubSnapshot(repository: string): Promise<ModGitHubSnapshot> {
  return getCachedSnapshot(normalizeModRepository(repository))
}

export async function getModGitHubReleases(repository: string, page: number): Promise<ModReleasePageResponse> {
  const normalizedRepository = normalizeModRepository(repository)
  if (!Number.isSafeInteger(page) || page < 1) {
    throw createError({ statusCode: 400, statusMessage: '릴리스 페이지는 1 이상의 정수로 입력해 주세요.' })
  }
  return getCachedReleases(normalizedRepository, page)
}
