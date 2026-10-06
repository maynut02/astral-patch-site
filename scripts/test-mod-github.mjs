import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

// Node 22.19 이상에서 node scripts/test-mod-github.mjs로 실행하며 서버나 인증 정보, 네트워크 없이 검증한다.
// 타입과 두 런타임 가져오기를 제거한 뒤 Nitro 전역 함수의 모형을 주입한다.
const source = readFileSync(new URL('../server/utils/mod-github.ts', import.meta.url), 'utf8')
  .replace(/^import \{ Buffer \} from 'node:buffer'\r?\n/m, '')
  .replace(/^import \{ createError \} from 'h3'\r?\n/m, '')
const executable = stripTypeScriptTypes(source).replace(/^export /gm, '')
const loadUtility = new Function('createError', '$fetch', 'defineCachedFunction', 'process', 'Buffer', `${executable}
return { normalizeModRepository, getModGitHubSnapshot, getModGitHubReleases }
`)

function response(data, headers = {}) {
  return { _data: data, headers: new Headers(headers) }
}

function githubError(status, headers = {}, message = '') {
  return Object.assign(new Error(message), {
    response: { status, headers: new Headers(headers) },
    data: { message }
  })
}

function repository(overrides = {}) {
  return {
    private: false,
    visibility: 'public',
    description: '공개 모드',
    default_branch: 'feature/docs',
    stargazers_count: 42,
    license: { spdx_id: 'MIT', name: 'MIT License' },
    archived: true,
    pushed_at: '2026-10-05T01:02:03Z',
    ...overrides
  }
}

function release(overrides = {}) {
  return {
    id: 123,
    tag_name: 'v1.0.0',
    name: '첫 릴리스',
    body: '# 변경 사항\n\n한국어 설명',
    html_url: 'https://github.com/owner/mod/releases/tag/v1.0.0',
    draft: false,
    prerelease: false,
    created_at: '2026-10-04T01:00:00Z',
    published_at: '2026-10-05T01:00:00Z',
    assets: [],
    ...overrides
  }
}

function commit(index = 0) {
  return {
    sha: String(index).padStart(40, 'a'),
    html_url: `https://github.com/owner/mod/commit/${index}`,
    author: { login: 'github-author' },
    commit: {
      message: `커밋 ${index}\n\n본문`,
      author: { name: '작성자', date: '2026-10-05T01:02:03Z' },
      committer: { name: '커미터', date: '2026-10-05T02:02:03Z' }
    }
  }
}

function defaultResponse(url) {
  if (url.endsWith('/readme')) {
    return response({ encoding: 'base64', content: '', path: 'README.md', html_url: 'https://github.com/owner/mod/blob/main/README.md' })
  }
  if (url.endsWith('/commits') || url.endsWith('/releases')) return response([])
  return response(repository())
}

function harness(handler = defaultResponse, token = '') {
  const calls = []
  const cacheOptions = []
  let now = 0
  const fetchMock = {
    async raw(url, options) {
      calls.push({ url, options })
      return handler(url, options)
    }
  }
  const defineCachedFunction = (fn, options) => {
    cacheOptions.push(options)
    const cache = new Map()
    return async (...args) => {
      const key = options.getKey(...args)
      const existing = cache.get(key)
      if (existing && existing.expires > now) return existing.value
      cache.delete(key)
      const value = await fn(...args)
      cache.set(key, { value, expires: now + options.maxAge * 1000 })
      return value
    }
  }
  const api = loadUtility(
    options => Object.assign(new Error(options.statusMessage), options),
    fetchMock,
    defineCachedFunction,
    { env: { GITHUB_TOKEN: token } },
    Buffer
  )
  return {
    ...api,
    calls,
    cacheOptions,
    advance(ms) { now += ms }
  }
}

function hasStatus(code, text) {
  return (error) => {
    assert.equal(error.statusCode, code)
    assert.match(error.statusMessage, /[가-힣]/)
    if (text) assert.match(error.statusMessage, text)
    return true
  }
}

test('repository normalization accepts canonical identifiers, .git, and trailing slash', () => {
  const { normalizeModRepository: normalize } = harness()
  for (const input of [
    'Owner/My_Mod.v1', 'Owner/My_Mod.v1/', 'Owner/My_Mod.v1.git',
    'https://github.com/Owner/My_Mod.v1', 'https://github.com/Owner/My_Mod.v1.git/',
    '  https://GITHUB.COM/Owner/My_Mod.v1/  '
  ]) assert.equal(normalize(input), 'owner/my_mod.v1')
  assert.equal(normalize(`a/${'r'.repeat(100)}.git/`), `a/${'r'.repeat(100)}`)
  assert.equal(normalize(`${'a'.repeat(39)}/repo`), `${'a'.repeat(39)}/repo`)
  assert.equal(normalize('owner-name/.github'), 'owner-name/.github')
})

test('repository normalization rejects unsafe hosts, credentials, URL rewriting, and malformed names', () => {
  const { normalizeModRepository: normalize } = harness()
  for (const input of [
    null, undefined, 123, {}, ['owner/mod'], '', 'owner', 'owner/mod/extra',
    'http://github.com/owner/mod', '//github.com/owner/mod',
    'https://github.com.evil.test/owner/mod', 'https://evil.test/owner/mod',
    'https://github.com@evil.test/owner/mod', 'https://user:pass@github.com/owner/mod',
    'https://github.com:443/owner/mod', 'https://github.com./owner/mod',
    'https://github.com/owner/mod?token=secret', 'https://github.com/owner/mod#readme',
    'https://github.com/owner/../mod', 'https://github.com/owner/%2e%2e/mod',
    'https://github.com/owner%2Fmod/repo', 'https://github.com/owner\\mod',
    'https://github.com//owner/mod', 'owner/mod//', 'owner/.', 'owner/..', 'owner/.git',
    'owner_name/mod', '-owner/mod', 'owner-/mod', 'owner--name/mod',
    `${'a'.repeat(40)}/mod`, `owner/${'r'.repeat(101)}`,
    'owner/mod\n', 'own\ter/mod', 'owner/mo\u0000d', 'git@github.com:owner/mod', '소유자/모드'
  ]) assert.throws(() => normalize(input), hasStatus(400), String(input))
})

test('snapshot verifies public metadata first and normalizes README, default-branch commits, releases, and assets', async () => {
  let validated = false
  const markdown = '# 모드\n\n**원문 Markdown**\n<script>example</script>\n'
  const asset = {
    id: 456, name: 'mod.zip', content_type: 'application/zip', size: 100,
    download_count: 7, created_at: 'created', updated_at: 'updated',
    browser_download_url: 'https://github.com/owner/mod/releases/download/v1.0.0/mod.zip'
  }
  const api = harness(async (url, options) => {
    if (url === 'https://api.github.com/repos/owner/mod') {
      await Promise.resolve()
      validated = true
      return response(repository())
    }
    assert.equal(validated, true, 'No content request before public validation')
    if (url.endsWith('/readme')) {
      assert.deepEqual(options.query, { ref: 'feature/docs' })
      return response({
        encoding: 'base64', content: Buffer.from(markdown).toString('base64').match(/.{1,20}/g).join('\n'),
        path: 'docs/README.md', html_url: 'https://github.com/owner/mod/blob/feature/docs/docs/README.md',
        download_url: 'https://arbitrary.test/never-fetch'
      })
    }
    if (url.endsWith('/commits')) {
      assert.deepEqual(options.query, { per_page: 10, sha: 'feature/docs' })
      return response(Array.from({ length: 12 }, (_, i) => commit(i)))
    }
    assert.equal(url.endsWith('/releases'), true)
    assert.deepEqual(options.query, { per_page: 20, page: 1 })
    return response([
      release({ name: null, body: null, published_at: null, prerelease: true, assets: [asset, {}, null] }),
      release({ draft: true }), release({ tag_name: null }), null
    ], { link: '<https://arbitrary.test/never-fetch>; rel="next"' })
  }, 'test-server-token')
  const snapshot = await api.getModGitHubSnapshot('https://github.com/Owner/Mod.git/')
  assert.equal(snapshot.repository, 'owner/mod')
  assert.equal(snapshot.url, 'https://github.com/owner/mod')
  assert.equal(snapshot.description, '공개 모드')
  assert.equal(snapshot.defaultBranch, 'feature/docs')
  assert.equal(snapshot.stars, 42)
  assert.equal(snapshot.license, 'MIT')
  assert.equal(snapshot.archived, true)
  assert.equal(snapshot.pushedAt, '2026-10-05T01:02:03Z')
  assert.deepEqual(snapshot.readme, {
    content: markdown, path: 'docs/README.md', url: 'https://github.com/owner/mod/blob/feature/docs/docs/README.md'
  })
  assert.equal(snapshot.commits.length, 10)
  assert.deepEqual(snapshot.commits[0], {
    sha: commit().sha, message: '커밋 0\n\n본문', author: '작성자',
    date: '2026-10-05T01:02:03Z', url: commit().html_url
  })
  assert.deepEqual(snapshot.releases, [{
    id: 123, tagName: 'v1.0.0', title: 'v1.0.0', body: '',
    url: release().html_url, prerelease: true, createdAt: release().created_at,
    publishedAt: release().created_at,
    assets: [{ id: 456, name: 'mod.zip', contentType: 'application/zip', size: 100, downloadCount: 7,
      createdAt: 'created', updatedAt: 'updated', downloadUrl: asset.browser_download_url }]
  }])
  assert.equal(snapshot.hasMoreReleases, true)
  assert.deepEqual(snapshot.warnings, [])
  assert.equal(Number.isNaN(Date.parse(snapshot.fetchedAt)), false)
  assert.equal(api.calls.length, 4)
  assert.equal(JSON.stringify(snapshot).includes('test-server-token'), false)
  for (const { url, options } of api.calls) {
    assert.equal(new URL(url).hostname, 'api.github.com')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, 'Bearer test-server-token')
    assert.equal(options.headers.Accept, 'application/vnd.github+json')
    assert.equal(options.headers['User-Agent'], 'astral-patch-site')
    assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28')
    assert.equal(options.timeout, 10_000)
    assert.equal(options.retry, 1)
    assert.equal(options.retryDelay, 250)
    assert.equal(options.retryStatusCodes.includes(429), false)
    assert.equal(options.retryStatusCodes.includes(403), false)
  }
})

test('private/internal repositories are rejected before content requests, even with a privileged token', async () => {
  for (const repo of [repository({ private: true, visibility: 'private' }), repository({ visibility: 'internal' })]) {
    const api = harness(() => response(repo), 'privileged-test-token')
    await assert.rejects(api.getModGitHubSnapshot('owner/mod'), hasStatus(403, /공개/))
    await assert.rejects(api.getModGitHubReleases('owner/mod', 2), hasStatus(403, /공개/))
    assert.deepEqual(api.calls.map(call => call.url), [
      'https://api.github.com/repos/owner/mod', 'https://api.github.com/repos/owner/mod'
    ])
  }
})

test('missing or malformed public/private metadata fails closed', async () => {
  for (const data of [null, [], {}, repository({ private: undefined }), repository({ private: 'false' })]) {
    const api = harness(() => response(data))
    await assert.rejects(api.getModGitHubSnapshot('owner/mod'), hasStatus(502))
    assert.equal(api.calls.length, 1)
  }
})

test('missing README and empty repository commits are expected empty results without warnings', async () => {
  const api = harness((url) => {
    if (url.endsWith('/readme')) throw githubError(404)
    if (url.endsWith('/commits')) throw githubError(409, {}, 'Git Repository is empty.')
    if (url.endsWith('/releases')) return response([])
    return response(repository({ description: null, stargazers_count: null, license: null, pushed_at: null }))
  })
  const snapshot = await api.getModGitHubSnapshot('owner/empty')
  assert.equal(snapshot.readme, null)
  assert.equal(snapshot.description, '')
  assert.equal(snapshot.stars, 0)
  assert.equal(snapshot.license, null)
  assert.equal(snapshot.pushedAt, null)
  assert.deepEqual(snapshot.commits, [])
  assert.deepEqual(snapshot.releases, [])
  assert.equal(snapshot.hasMoreReleases, false)
  assert.deepEqual(snapshot.warnings, [])
})

test('partial failures preserve successful content and produce Korean warnings without upstream secrets', async () => {
  const api = harness((url) => {
    if (url.endsWith('/readme')) throw new Error('secret upstream token must not leak')
    if (url.endsWith('/releases')) throw githubError(403, { 'x-ratelimit-remaining': '0' })
    if (url.endsWith('/commits')) return response([commit()])
    return response(repository())
  })
  const snapshot = await api.getModGitHubSnapshot('owner/mod')
  assert.equal(snapshot.commits.length, 1)
  assert.equal(snapshot.readme, null)
  assert.deepEqual(snapshot.releases, [])
  assert.equal(snapshot.warnings.length, 2)
  assert.match(snapshot.warnings[0], /README:.*불러오지/)
  assert.match(snapshot.warnings[1], /릴리스:.*요청 한도/)
  assert.equal(JSON.stringify(snapshot).includes('secret upstream'), false)
})

test('commit failures preserve README and releases; missing author falls back to the committer', async () => {
  const api = harness((url) => {
    if (url.endsWith('/commits')) throw githubError(503)
    if (url.endsWith('/releases')) return response([release()])
    return defaultResponse(url)
  })
  const snapshot = await api.getModGitHubSnapshot('owner/mod')
  assert.equal(snapshot.readme.content, '')
  assert.equal(snapshot.releases.length, 1)
  assert.deepEqual(snapshot.commits, [])
  assert.match(snapshot.warnings[0], /커밋:/)

  const fallback = commit()
  fallback.commit.author = null
  fallback.author = null
  const other = harness(url => url.endsWith('/commits') ? response([null, {}, fallback]) : defaultResponse(url))
  const commits = (await other.getModGitHubSnapshot('owner/mod')).commits
  assert.equal(commits.length, 1)
  assert.equal(commits[0].author, '커미터')
  assert.equal(commits[0].date, '2026-10-05T02:02:03Z')
})

test('malformed README encoding or endpoint payloads becomes partial warnings', async () => {
  const api = harness((url) => {
    if (url.endsWith('/readme')) return response({ encoding: 'base64', path: 'README.md', content: 'invalid!!' })
    if (url.endsWith('/commits') || url.endsWith('/releases')) return response({ unexpected: true })
    return response(repository({ license: { spdx_id: 'NOASSERTION', name: 'Custom License' } }))
  })
  const snapshot = await api.getModGitHubSnapshot('owner/mod')
  assert.equal(snapshot.license, 'Custom License')
  assert.equal(snapshot.readme, null)
  assert.deepEqual(snapshot.commits, [])
  assert.deepEqual(snapshot.releases, [])
  assert.equal(snapshot.warnings.length, 3)
})

test('README limit accepts exactly 100,000 decoded characters, including multibyte text', async () => {
  for (const character of ['a', '가']) {
    const markdown = character.repeat(100_000)
    const api = harness(url => url.endsWith('/readme')
      ? response({ encoding: 'base64', path: 'README.md', content: Buffer.from(markdown).toString('base64'),
          html_url: 'https://github.com/owner/mod/blob/main/README.md' })
      : defaultResponse(url))
    const snapshot = await api.getModGitHubSnapshot('owner/mod')
    assert.equal(snapshot.readme?.content, markdown)
    assert.deepEqual(snapshot.warnings, [])
  }
})

test('oversized decoded README falls back to a warning while preserving and caching other snapshot data', async () => {
  for (const character of ['a', '가']) {
    const markdown = character.repeat(100_001)
    const api = harness((url) => {
      if (url.endsWith('/readme')) {
        return response({ encoding: 'base64', path: 'README.md', content: Buffer.from(markdown).toString('base64'),
          html_url: 'https://github.com/owner/mod/blob/main/README.md' })
      }
      if (url.endsWith('/commits')) return response([commit()])
      if (url.endsWith('/releases')) return response([release()], { link: '<https://api.github.com/repos/owner/mod/releases?page=2>; rel="next"' })
      return defaultResponse(url)
    })
    const snapshot = await api.getModGitHubSnapshot('owner/mod')
    assert.equal(snapshot.readme, null)
    assert.equal(snapshot.commits.length, 1)
    assert.equal(snapshot.releases.length, 1)
    assert.equal(snapshot.hasMoreReleases, true)
    assert.equal(snapshot.description, '공개 모드')
    assert.equal(snapshot.warnings.length, 1)
    assert.match(snapshot.warnings[0], /^README:.*100,000자를 초과.*GitHub/)
    assert.equal(JSON.stringify(snapshot).includes(markdown), false)
    assert.equal(await api.getModGitHubSnapshot('Owner/Mod'), snapshot)
    assert.equal(api.calls.length, 4)
  }
})

test('missing repositories, rate limits, permission errors, and network errors map to Korean h3 errors', async () => {
  for (const [error, status, text] of [
    [githubError(404), 404, /찾을 수 없거나 비공개/],
    [githubError(429), 429, /요청 한도/],
    [githubError(403, { 'x-ratelimit-remaining': '0' }), 429, /요청 한도/],
    [githubError(403, { 'retry-after': '60' }), 429, /요청 한도/],
    [githubError(403, {}, 'You have exceeded a secondary rate limit.'), 429, /요청 한도/],
    [githubError(403), 502, /접근할 수 없/],
    [githubError(401), 502, /접근할 수 없/],
    [new Error('Timeout with secret token'), 502, /불러오지/]
  ]) {
    const api = harness(() => {
      throw error
    })
    await assert.rejects(api.getModGitHubSnapshot('owner/mod'), hasStatus(status, text))
    await assert.rejects(api.getModGitHubReleases('owner/mod', 1), hasStatus(status, text))
    assert.equal(api.calls.length, 2)
  }
})

test('release pages include prereleases, omit drafts, and use Link pagination even for a full final page', async () => {
  const api = harness((url, options) => {
    if (!url.endsWith('/releases')) return defaultResponse(url)
    const rows = Array.from({ length: 20 }, (_, i) => release({ id: i, prerelease: i === 0, draft: i === 1 }))
    return response(rows, options.query.page === 2 ? { link: '<https://api.github.com/repos/owner/mod/releases?page=3>; rel="next"' } : {})
  })
  const second = await api.getModGitHubReleases('owner/mod', 2)
  assert.equal(second.page, 2)
  assert.equal(second.hasMore, true)
  assert.equal(second.releases.length, 19)
  assert.equal(second.releases[0].prerelease, true)
  const final = await api.getModGitHubReleases('owner/mod', 3)
  assert.equal(final.hasMore, false)
  assert.equal(api.calls[0].url, 'https://api.github.com/repos/owner/mod')
  assert.equal(api.calls[2].url, 'https://api.github.com/repos/owner/mod')
  for (const call of api.calls.filter(call => call.url.endsWith('/releases'))) {
    assert.equal(call.options.query.per_page, 20)
  }
  assert.equal(api.calls.some(call => 'Authorization' in call.options.headers), false)
})

test('release endpoint failures are mapped after public validation and are not cached', async () => {
  let fail = true
  const api = harness((url) => {
    if (url.endsWith('/releases')) {
      if (fail) throw githubError(429)
      return response([release()])
    }
    return defaultResponse(url)
  })
  await assert.rejects(api.getModGitHubReleases('owner/mod', 1), hasStatus(429))
  fail = false
  assert.equal((await api.getModGitHubReleases('owner/mod', 1)).releases.length, 1)
  assert.equal(api.calls.length, 4)
})

test('cache keys separate repositories/pages and expire after five minutes without stale reuse', async () => {
  let privateRepo = false
  const api = harness(url => !url.endsWith('/readme') && !url.endsWith('/commits') && !url.endsWith('/releases')
    ? response(repository({ private: privateRepo }))
    : defaultResponse(url))
  for (const options of api.cacheOptions) {
    assert.equal(options.maxAge, 300)
    assert.equal(options.swr, false)
  }
  const first = await api.getModGitHubSnapshot('owner/mod')
  assert.equal(await api.getModGitHubSnapshot('https://github.com/Owner/Mod.git/'), first)
  assert.equal(api.calls.length, 4)
  await api.getModGitHubSnapshot('owner/other')
  assert.equal(api.calls.length, 8)
  await api.getModGitHubReleases('owner/mod', 1)
  await api.getModGitHubReleases('Owner/Mod', 1)
  await api.getModGitHubReleases('owner/mod', 2)
  await api.getModGitHubReleases('owner/other', 1)
  assert.equal(api.calls.length, 14)
  api.advance(299_999)
  assert.equal(await api.getModGitHubSnapshot('owner/mod'), first)
  assert.equal(api.calls.length, 14)
  api.advance(1)
  privateRepo = true
  await assert.rejects(api.getModGitHubSnapshot('owner/mod'), hasStatus(403))
  await assert.rejects(api.getModGitHubReleases('owner/mod', 1), hasStatus(403))
  assert.equal(api.calls.length, 16)
})

test('invalid repository/page input never invokes GitHub or the cached loader', async () => {
  const api = harness()
  await assert.rejects(api.getModGitHubSnapshot('https://evil.test/owner/mod'), hasStatus(400))
  for (const page of [0, -1, 1.5, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(api.getModGitHubReleases('owner/mod', page), hasStatus(400))
  }
  assert.equal(api.calls.length, 0)
})
