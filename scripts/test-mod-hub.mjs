import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { Socket } from 'node:net'
import { beforeEach, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Run with: node scripts/test-mod-hub.mjs
// Transpile the actual utilities/handlers and replace only their DB/network
// boundaries. No Nuxt server, database connection, or GitHub request is made.
const require = createRequire(import.meta.url)
const nuxtRequire = createRequire(require.resolve('nuxt/package.json'))
const h3Url = pathToFileURL(nuxtRequire.resolve('h3')).href
const { createEvent, createError } = await import(h3Url)
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

async function transformModule(path, imports = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText.replace(/from (['"])([^'"]+)\1/g, (match, _quote, specifier) => {
    const replacement = specifier === 'h3' ? h3Url : imports[specifier]
    if (replacement) return `from ${JSON.stringify(replacement)}`
    assert.ok(specifier.startsWith('node:'), `Unmocked import in ${path}: ${specifier}`)
    return match
  })
  return moduleUrl(compiled)
}

let state
globalThis.defineCachedFunction = operation => operation
globalThis.defineEventHandler = handler => handler
globalThis.getUserSession = async () => state.session
globalThis.setUserSession = async (_event, session) => {
  state.session = session
}
globalThis.replaceUserSession = async (_event, session) => {
  state.refreshCalls.push(session)
  state.session = { id: 'rotated-session', ...session }
}
globalThis.__modHubTest = {
  getDatabase: () => state.database,
  async getModGitHubAbout(repository) {
    state.aboutCalls.push(repository)
    state.aboutActive++
    state.aboutMaxActive = Math.max(state.aboutMaxActive, state.aboutActive)
    try {
      return state.onAbout ? await state.onAbout(repository) : state.aboutDescriptions.get(repository) ?? ''
    } finally {
      state.aboutActive--
    }
  },
  async getModGitHubSnapshot(repository) {
    state.snapshotCalls.push(repository)
    if (state.githubError) throw state.githubError
    if (state.onSnapshot) await state.onSnapshot()
    return { repository: state.canonicalRepository || repository, releases: [], commits: [], warnings: [] }
  },
  async getModGitHubReleases(repository, page) {
    state.releaseCalls.push({ repository, page })
    return { releases: [], page, hasMore: page === 1 }
  },
  async getModGitHubCommits(repository, branch) {
    state.commitCalls.push({ repository, branch })
    return { branch: branch ?? 'main', commits: [] }
  },
  async isRateLimited(database, bucketKey, windows) {
    assert.equal(database, state.database)
    state.rateCalls.push({ bucketKey, windows })
    return state.limited
  }
}

const databaseUrl = moduleUrl('export const getDatabase = () => globalThis.__modHubTest.getDatabase()')
const githubErrorsUrl = await transformModule('server/utils/github/errors.ts')
const githubNormalizersUrl = await transformModule('server/utils/github/normalizers.ts')
const githubUrl = await transformModule('server/utils/mod-github.ts', {
  './github/errors': githubErrorsUrl,
  './github/normalizers': githubNormalizersUrl
})
const githubMockUrl = moduleUrl(`
  export { normalizeModRepository, parseModBranch } from ${JSON.stringify(githubUrl)}
  export const getModGitHubAbout = (...args) => globalThis.__modHubTest.getModGitHubAbout(...args)
  export const getModGitHubSnapshot = (...args) => globalThis.__modHubTest.getModGitHubSnapshot(...args)
  export const getModGitHubReleases = (...args) => globalThis.__modHubTest.getModGitHubReleases(...args)
  export const getModGitHubCommits = (...args) => globalThis.__modHubTest.getModGitHubCommits(...args)
`)
const rateUrl = moduleUrl('export const isRateLimited = (...args) => globalThis.__modHubTest.isRateLimited(...args)')
const validationUrl = await transformModule('server/utils/validation.ts')
const typesUrl = await transformModule('shared/types/mod.ts')
const userTypesUrl = await transformModule('shared/types/user.ts')
const securityUrl = await transformModule('server/utils/request-security.ts')
const modRateUrl = await transformModule('server/utils/mod-rate-limit.ts', {
  './database': databaseUrl,
  './rate-limiter': rateUrl
})
const hubUrl = await transformModule('server/utils/mod-hub.ts', {
  '#shared/types/mod': typesUrl,
  './database': databaseUrl,
  './mod-github': githubMockUrl,
  './mod-rate-limit': modRateUrl,
  './validation': validationUrl,
  './request-security': securityUrl
})
const hub = await import(hubUrl)
const authUrl = await transformModule('server/utils/auth-user.ts', { './database': databaseUrl })
const accountUrl = await transformModule('server/utils/user-account.ts', { './database': databaseUrl, '#shared/types/user': userTypesUrl })
const { deleteUserAccount } = await import(accountUrl)
const sessionRefreshMiddleware = (await import(await transformModule('server/middleware/session-refresh.ts'))).default
const modCacheMiddleware = (await import(await transformModule('server/middleware/mod-cache.ts'))).default
const routes = {}
for (const [key, path, prefix] of [
  ['list', 'server/api/mods.get.ts', '../utils/'],
  ['create', 'server/api/mods.post.ts', '../utils/'],
  ['detail', 'server/api/mods/[id].get.ts', '../../utils/'],
  ['update', 'server/api/mods/[id].patch.ts', '../../utils/'],
  ['delete', 'server/api/mods/[id].delete.ts', '../../utils/'],
  ['releases', 'server/api/mods/[id]/releases.get.ts', '../../../utils/'],
  ['commits', 'server/api/mods/[id]/commits.get.ts', '../../../utils/']
]) {
  routes[key] = (await import(await transformModule(path, {
    [`${prefix}auth-user`]: authUrl,
    [`${prefix}mod-hub`]: hubUrl,
    [`${prefix}request-security`]: securityUrl
  }))).default
}

const modId = '1'
const missingId = '999'
const maxModId = '9223372036854775807'
const unsafeIntegerModId = '9007199254740993'
const input = { name: '테스트 모드', summary: '요약', description: '# 설명\n\n본문', repository: 'owner/repo', platforms: ['windows'] }

function rowFor(mod, viewerId) {
  const author = state.accounts.get(mod.createdBy)
  const viewer = state.accounts.get(viewerId)
  const isOwner = Boolean(viewer && mod.createdBy === viewerId)
  return {
    ...mod,
    authorHandle: author?.handle ?? null,
    authorRole: author?.role ?? 'user',
    isOwner,
    canEdit: isOwner || viewer?.role === 'admin',
    // Ensure public mapping cannot accidentally spread internal DB identities.
    googleSub: mod.createdBy,
    email: author?.email
  }
}

function memoryDatabase() {
  const database = async (strings, ...values) => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim()
    state.sql.push({ sql, values })
    if (sql.startsWith('SELECT') && sql.includes('FROM app_users')) {
      const account = state.accounts.get(values[0])
      return account ? [{ ...account }] : []
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM mods m')) {
      // Ownership and permissions come from current DB accounts, never supplied roles.
      assert.match(sql, /COALESCE\(m\.created_by = viewer\.google_sub, false\) AS "isOwner"/)
      assert.match(sql, /COALESCE\(m\.created_by = viewer\.google_sub OR viewer\."role" = 'admin', false\) AS "canEdit"/)
      assert.match(sql, /LEFT JOIN app_users viewer ON viewer\.google_sub = \?/)
      if (sql.includes('WHERE m.id')) {
        const mod = state.mods.get(values[1])
        return mod ? [rowFor(mod, values[0])] : []
      }
      assert.match(sql, /ORDER BY m\.updated_at DESC, m\.id DESC LIMIT \?/)
      return [...state.mods.values()].slice(0, values[1]).map(mod => rowFor(mod, values[0]))
    }
    if (sql.startsWith('SELECT repository FROM mods')) {
      const mod = state.mods.get(values[0])
      return mod ? [{ repository: mod.repository }] : []
    }
    if (sql.startsWith('INSERT INTO mods')) {
      assert.match(sql, /^INSERT INTO mods \(name, summary, description, repository, platforms, created_by\) VALUES /)
      assert.match(sql, / RETURNING id(?:::text(?: AS "?id"?)?)?$/)
      assert.equal(values.length, 6)
      const [name, summary, description, repository, platforms, createdBy] = values
      const id = String(state.nextModId++)
      if ([...state.mods.values()].some(mod => mod.repository.toLowerCase() === repository.toLowerCase())) {
        throw Object.assign(new Error('unique repository'), { code: '23505' })
      }
      state.mods.set(id, { id, name, summary, description, repository, platforms, createdBy, createdAt: new Date(), updatedAt: new Date() })
      return [{ id }]
    }
    if (sql.startsWith('UPDATE mods')) {
      assert.match(sql, /WHERE m\.id = \? AND EXISTS \( SELECT 1 FROM app_users actor WHERE actor\.google_sub = \? AND \(m\.created_by = actor\.google_sub OR actor\."role" = 'admin'\) \) RETURNING m\.id$/)
      const [name, summary, description, repository, platforms, id, ownerId] = values
      if (state.onUpdate) await state.onUpdate()
      const mod = state.mods.get(id)
      const actor = state.accounts.get(ownerId)
      if (!mod || !actor || (mod.createdBy !== ownerId && actor.role !== 'admin')) return []
      if ([...state.mods.values()].some(other => other.id !== id && other.repository.toLowerCase() === repository.toLowerCase())) {
        throw Object.assign(new Error('unique repository'), { code: '23505' })
      }
      Object.assign(mod, { name, summary, description, repository, platforms, updatedAt: new Date() })
      return [{ id }]
    }
    if (sql.startsWith('DELETE FROM mods')) {
      assert.match(sql, /WHERE m\.id = \? AND EXISTS \( SELECT 1 FROM app_users actor WHERE actor\.google_sub = \? AND \(m\.created_by = actor\.google_sub OR actor\."role" = 'admin'\) \) RETURNING m\.id$/)
      const [id, actorId] = values
      if (state.onDelete) await state.onDelete()
      const mod = state.mods.get(id)
      const actor = state.accounts.get(actorId)
      if (!mod || !actor || (mod.createdBy !== actorId && actor.role !== 'admin')) return []
      state.mods.delete(id)
      return [{ id }]
    }
    throw new Error(`Unexpected query: ${sql}`)
  }
  database.array = value => value
  return database
}

beforeEach(() => {
  state = {
    accounts: new Map(['owner', 'other', 'admin'].map(id => [id, {
      googleSub: id, email: `${id}@example.test`, handle: id, role: id === 'admin' ? 'admin' : 'user'
    }])),
    mods: new Map([[modId, {
      ...input, id: modId, createdBy: 'owner', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01')
    }]]),
    nextModId: 2n,
    aboutDescriptions: new Map([['owner/repo', 'GitHub About 소개']]),
    aboutCalls: [], aboutActive: 0, aboutMaxActive: 0,
    sql: [], snapshotCalls: [], releaseCalls: [], commitCalls: [], rateCalls: [], session: {}, limited: false
  }
  state.database = memoryDatabase()
})

function signIn(id) {
  const account = state.accounts.get(id)
  state.session = { user: { id, email: account.email, handle: account.handle, role: account.role } }
}

function event(method, path = '/api/mods', body, headers = {}) {
  const request = new IncomingMessage(new Socket())
  request.method = method
  request.url = path
  const payload = body === undefined ? '' : JSON.stringify(body)
  request.headers = {
    'host': 'localhost',
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
    'origin': 'http://localhost',
    ...headers
  }
  if (payload) request.push(payload)
  request.push(null)
  const result = createEvent(request, new ServerResponse(request))
  const pathname = new URL(path, 'http://localhost').pathname
  const id = pathname.match(/^\/api\/mods\/([^/]+)(?:\/(?:releases|commits))?$/)?.[1]
  result.context.params = id === undefined ? {} : { id: decodeURIComponent(id) }
  modCacheMiddleware(result)
  return result
}

function status(code) {
  return error => error.statusCode === code
}

test('public list is bounded and grants admin management without misreporting ownership', async () => {
  for (const viewerId of [null, 'owner', 'other', 'admin']) {
    const response = await hub.getMods(viewerId)
    assert.equal(response.mods[0].isOwner, viewerId === 'owner')
    assert.equal(response.mods[0].canEdit, viewerId === 'owner' || viewerId === 'admin')
    assert.equal(response.mods[0].canDelete, viewerId === 'owner' || viewerId === 'admin')
    assert.equal(response.mods[0].githubDescription, 'GitHub About 소개')
    assert.equal(response.mods[0].createdAt, '2026-01-01T00:00:00.000Z')
    for (const key of ['googleSub', 'createdBy', 'created_by', 'email', 'ownerId']) {
      assert.equal(key in response.mods[0], false)
    }
    assert.equal(state.sql.at(-1).values.at(-1), 200)
  }
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.releaseCalls.length, 0)
  assert.deepEqual(state.aboutCalls, Array(4).fill('owner/repo'))
})

test('list enriches About without replacing persisted summary or fetching detail data', async () => {
  const description = '  GitHub About: 한글 패치 🙂  '
  state.aboutDescriptions.set('owner/repo', description)
  const { mods } = await hub.getMods('owner')
  assert.equal(mods[0].githubDescription, description)
  assert.equal(mods[0].summary, input.summary)
  assert.equal(mods[0].description, input.description)
  assert.equal(mods[0].canEdit, true)
  assert.equal(state.mods.get(modId).summary, input.summary)
  assert.equal('githubDescription' in state.mods.get(modId), false)
  assert.deepEqual(state.aboutCalls, ['owner/repo'])
  assert.deepEqual(state.snapshotCalls, [])
  assert.deepEqual(state.releaseCalls, [])
  assert.equal(state.sql.length, 1)
})

test('empty About stays empty instead of falling back to manual summary', async () => {
  state.aboutDescriptions.set('owner/repo', '')
  const { mods } = await hub.getMods()
  assert.equal(mods[0].githubDescription, '')
  assert.equal(mods[0].summary, input.summary)
  assert.equal(mods[0].canEdit, false)
  assert.equal(state.snapshotCalls.length, 0)
})

test('one About lookup failure keeps the list and other descriptions usable', async () => {
  const base = state.mods.get(modId)
  state.mods.set('2', { ...base, id: '2', repository: 'other/failed', createdBy: 'other' })
  state.mods.set('3', { ...base, id: '3', repository: 'owner/third' })
  state.onAbout = async (repository) => {
    if (repository === 'other/failed') throw new Error('private token and upstream failure')
    return `About ${repository}`
  }
  const { mods } = await hub.getMods('owner')
  assert.deepEqual(mods.map(mod => mod.id), ['1', '2', '3'])
  assert.deepEqual(mods.map(mod => mod.githubDescription), ['About owner/repo', '', 'About owner/third'])
  assert.deepEqual(mods.map(mod => mod.canEdit), [true, false, true])
  assert.ok(mods.every(mod => mod.summary === input.summary))
  assert.doesNotMatch(JSON.stringify(mods), /private token|upstream failure/)
  assert.equal(state.aboutCalls.length, 3)
  assert.equal(state.aboutActive, 0)
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.releaseCalls.length, 0)
})

test('duplicate repositories share one About lookup without changing list rows', async () => {
  const base = state.mods.get(modId)
  state.mods.set('2', { ...base, id: '2', name: '두 번째 모드', createdBy: 'other' })
  const { mods } = await hub.getMods('owner')
  assert.deepEqual(state.aboutCalls, ['owner/repo'])
  assert.deepEqual(mods.map(mod => mod.id), ['1', '2'])
  assert.deepEqual(mods.map(mod => mod.githubDescription), ['GitHub About 소개', 'GitHub About 소개'])
  assert.deepEqual(mods.map(mod => mod.canEdit), [true, false])
})

test('About workers preserve DB order and ownership with at most six concurrent lookups', async () => {
  const base = state.mods.get(modId)
  state.mods.clear()
  for (let id = 17; id > 0; id--) {
    state.mods.set(String(id), {
      ...base, id: String(id), repository: `owner/repo-${id}`, createdBy: id % 2 ? 'owner' : 'other'
    })
  }
  const expected = [...state.mods.values()]
  const pending = new Map()
  const completed = []
  state.onAbout = repository => new Promise(resolve => pending.set(repository, resolve))
  const responsePromise = hub.getMods('owner')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(state.aboutCalls, expected.slice(0, 6).map(mod => mod.repository))
  assert.equal(pending.size, 6)
  while (pending.size) {
    for (const [repository, resolve] of [...pending].reverse()) {
      pending.delete(repository)
      completed.push(repository)
      resolve(`About ${repository}`)
    }
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(pending.size <= 6)
  }
  const { mods } = await responsePromise
  assert.equal(state.aboutMaxActive, 6)
  assert.equal(state.aboutActive, 0)
  assert.deepEqual(state.aboutCalls, expected.map(mod => mod.repository))
  assert.notDeepEqual(completed, state.aboutCalls)
  assert.deepEqual(mods.map(mod => mod.id), expected.map(mod => mod.id))
  assert.deepEqual(mods.map(mod => mod.githubDescription), expected.map(mod => `About ${mod.repository}`))
  assert.deepEqual(mods.map(mod => mod.canEdit), expected.map(mod => mod.createdBy === 'owner'))
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.releaseCalls.length, 0)
})

test('empty list skips About and detail lookups', async () => {
  state.mods.clear()
  assert.deepEqual(await hub.getMods('owner'), { mods: [] })
  assert.equal(state.aboutCalls.length, 0)
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.releaseCalls.length, 0)
})

test('validation enforces text limits, Unicode length, supported platforms and strict repo', () => {
  const valid = hub.parseModSaveInput({ ...input, name: '🙂'.repeat(120), summary: '가'.repeat(300), description: '가'.repeat(20_000), platforms: ['android', 'windows', 'android'] })
  assert.deepEqual(valid.platforms, ['windows', 'android'])
  assert.equal(hub.parseModSaveInput({ ...input, repository: 'https://github.com/OWNER/REPO.git/' }).repository, 'owner/repo')
  assert.equal(hub.parseModSaveInput({ name: '모드', repository: input.repository, platforms: input.platforms }).summary, '')
  for (const patch of [
    { name: '' }, { name: null }, { name: 'x'.repeat(121) }, { name: '\0' },
    { summary: 'x'.repeat(301) }, { description: 'x'.repeat(20_001) },
    { platforms: [] }, { platforms: ['ios'] }, { platforms: ['windows', null] },
    { platforms: 'windows' }, { repository: 'https://evil.test/owner/repo' },
    { repository: 'https://github.com/owner/repo?token=secret' }, { repository: 'owner/../repo' }
  ]) {
    assert.throws(() => hub.parseModSaveInput({ ...input, ...patch }), status(400))
  }
  for (const value of [null, [], 'text']) assert.throws(() => hub.parseModSaveInput(value), status(400))
})

test('mod IDs accept canonical positive bigint strings without losing precision', () => {
  for (const id of [
    modId, '9', '10', '100', '9007199254740991', '9007199254740992', unsafeIntegerModId,
    '999999999999999999', '1000000000000000000', '9223372036854775806', maxModId
  ]) {
    assert.equal(hub.parseModId(id), id)
    assert.equal(typeof hub.parseModId(id), 'string')
  }
  assert.equal(state.sql.length, 0)
})

test('invalid mod IDs are rejected before SQL or GitHub', async () => {
  for (const id of [
    '11111111-1111-4111-8111-111111111111', 'bad', `${modId}' OR true`, '',
    '0', '00', '01', '001', '-1', '+1', '1.0', '0.1', '1e2', '1E2', '0x10',
    ' 1', '1 ', '\t1', '1\n', '1\r', '\n1', '1\u00A0', '1\0', '１', '١',
    '9223372036854775808', '9999999999999999999', '10000000000000000000',
    null, undefined, 0, 1, Number.MAX_SAFE_INTEGER, 1n, BigInt(maxModId), true, ['1'], {}, new String('1')
  ]) {
    assert.throws(() => hub.parseModId(id), status(400), `Invalid ID: ${String(id)}`)
    await assert.rejects(hub.getModDetail(id), status(400))
    await assert.rejects(hub.updateMod('owner', id, input), status(400))
    await assert.rejects(hub.getModReleases(id, '1'), status(400))
  }
  assert.equal(state.sql.length, 0)
  assert.equal(state.snapshotCalls.length, 0)
})

test('detail retains DB metadata when GitHub is unavailable and hides error internals', async () => {
  state.githubError = new Error('secret token / private URL')
  const response = await hub.getModDetail(modId, 'owner')
  assert.equal(response.mod.canEdit, true)
  assert.equal(response.github, null)
  assert.match(response.githubError, /GitHub/)
  assert.doesNotMatch(response.githubError, /secret|private/)
  await assert.rejects(hub.getModDetail(missingId), status(404))
  assert.equal(state.snapshotCalls.length, 1)
})

test('detail preserves safe Korean GitHub private/rate-limit reasons', async () => {
  for (const [statusCode, statusMessage] of [
    [403, '공개 GitHub 저장소만 사용할 수 있습니다.'],
    [404, 'GitHub 저장소를 찾을 수 없거나 비공개 저장소입니다.'],
    [429, 'GitHub API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.']
  ]) {
    state.githubError = createError({ statusCode, statusMessage })
    const response = await hub.getModDetail(modId)
    assert.equal(response.github, null)
    assert.equal(response.githubError, statusMessage)
    assert.equal(response.mod.name, input.name)
  }
})

test('create checks public repo and stores canonical github.repository with session owner', async () => {
  state.canonicalRepository = 'canonical/project'
  const mod = await hub.createMod('owner', { ...input, repository: 'request/project', created_by: 'admin', canEdit: true })
  assert.deepEqual(state.snapshotCalls, ['request/project'])
  assert.equal(mod.repository, 'canonical/project')
  assert.equal(mod.id, '2')
  assert.equal(state.mods.get(mod.id).createdBy, 'owner')
  assert.equal(mod.canEdit, true)
  assert.equal(state.rateCalls[0].bucketKey, 'mod-mutation:owner')
  assert.deepEqual(state.rateCalls[0].windows.map(({ limit, windowMs }) => [limit, windowMs]), [[10, 60_000], [60, 3_600_000]])
})

test('consecutive registrations receive DB-generated string IDs starting at 1', async () => {
  state.mods.clear()
  state.nextModId = 1n
  const first = await hub.createMod('owner', { ...input, id: maxModId, repository: 'owner/first' })
  const second = await hub.createMod('other', { ...input, id: '1', repository: 'other/second' })
  const third = await hub.createMod('owner', { ...input, repository: 'owner/third' })
  assert.deepEqual([first.id, second.id, third.id], ['1', '2', '3'])
  assert.deepEqual([...state.mods.keys()], ['1', '2', '3'])
  assert.equal(state.mods.get(second.id).createdBy, 'other')
  assert.equal(state.sql.filter(({ sql }) => sql.startsWith('INSERT INTO mods')).length, 3)
})

test('DB-generated IDs preserve precision above JS safe integers and at bigint max', async () => {
  state.nextModId = BigInt(unsafeIntegerModId)
  const first = await hub.createMod('owner', { ...input, repository: 'owner/large-first' })
  const second = await hub.createMod('owner', { ...input, repository: 'owner/large-second' })
  assert.equal(first.id, unsafeIntegerModId)
  assert.equal(second.id, '9007199254740994')
  state.nextModId = BigInt(maxModId)
  const last = await hub.createMod('owner', { ...input, repository: 'owner/max-id' })
  assert.equal(last.id, maxModId)
  for (const mod of [first, second, last]) {
    assert.equal(typeof mod.id, 'string')
    assert.equal(JSON.parse(JSON.stringify(mod)).id, mod.id)
    assert.equal(state.mods.get(mod.id).id, mod.id)
  }
})

test('private/unavailable GitHub repo prevents insertion', async () => {
  state.githubError = createError({ statusCode: 403, statusMessage: '공개 저장소만 등록할 수 있습니다.' })
  await assert.rejects(hub.createMod('owner', { ...input, repository: 'owner/private' }), status(403))
  assert.equal(state.mods.size, 1)
  assert.equal(state.sql.some(({ sql }) => sql.startsWith('INSERT')), false)
})

test('case-insensitive repository uniqueness returns Korean 409 for create and update', async () => {
  await assert.rejects(hub.createMod('other', { ...input, repository: 'OWNER/REPO' }), error => status(409)(error) && /이미 등록/.test(error.message))
  state.mods.set(missingId, { ...state.mods.get(modId), id: missingId, repository: 'OTHER/PROJECT' })
  await assert.rejects(hub.updateMod('owner', modId, { repository: 'other/project' }), status(409))
  assert.equal(state.mods.get(modId).repository, 'owner/repo')
})

test('nonowners without admin permission are rejected before validation or network', async () => {
  for (const userId of ['other', 'missing-user']) {
    await assert.rejects(hub.updateMod(userId, modId, { repository: 'owner/new' }), status(403))
  }
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.rateCalls.length, 0)
  assert.equal(state.sql.some(({ sql }) => sql.startsWith('UPDATE')), false)
})

test('owner can edit Markdown metadata offline, including equivalent repository URLs', async () => {
  state.githubError = new Error('GitHub outage')
  const updated = await hub.updateMod('owner', modId, {
    name: '새 이름', description: '# 변경\n\n**본문**', repository: 'https://github.com/OWNER/REPO.git/', created_by: 'admin'
  })
  assert.equal(updated.name, '새 이름')
  assert.equal(updated.summary, input.summary)
  assert.equal(updated.description, '# 변경\n\n**본문**')
  assert.equal(updated.repository, 'owner/repo')
  assert.equal(state.mods.get(modId).createdBy, 'owner')
  assert.equal(state.snapshotCalls.length, 0)
})

test('repository changes are publicly validated and canonicalized before update', async () => {
  state.canonicalRepository = 'canonical/new'
  const updated = await hub.updateMod('owner', modId, { repository: 'owner/new' })
  assert.deepEqual(state.snapshotCalls, ['owner/new'])
  assert.equal(updated.repository, 'canonical/new')
  state.githubError = createError({ statusCode: 404, statusMessage: '저장소를 찾을 수 없습니다.' })
  await assert.rejects(hub.updateMod('owner', modId, { repository: 'owner/missing', name: '실패' }), status(404))
  assert.equal(state.mods.get(modId).name, input.name)
})

test('atomic SQL owner predicate rejects an ownership change during GitHub validation', async () => {
  state.onSnapshot = () => {
    state.mods.get(modId).createdBy = 'deleted:anonymous'
  }
  await assert.rejects(hub.updateMod('owner', modId, { repository: 'owner/new' }), status(403))
  assert.equal(state.mods.get(modId).repository, 'owner/repo')
  assert.equal(state.mods.get(modId).name, input.name)
})

test('atomic owner predicate also protects metadata edits from concurrent account deletion', async () => {
  state.onUpdate = () => {
    state.mods.get(modId).createdBy = 'deleted:anonymous'
  }
  await assert.rejects(hub.updateMod('owner', modId, { name: '변경' }), status(403))
  assert.equal(state.mods.get(modId).name, input.name)
})

test('shared mutation rate limit blocks create/update before GitHub and writes', async () => {
  state.limited = true
  await assert.rejects(hub.createMod('owner', { ...input, repository: 'owner/new' }), status(429))
  await assert.rejects(hub.updateMod('owner', modId, { repository: 'owner/new' }), status(429))
  await assert.rejects(hub.deleteMod('owner', modId), status(429))
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.sql.some(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql)), false)
  assert.equal(state.rateCalls[0].bucketKey, state.rateCalls[1].bucketKey)
})

test('release pagination uses stored repo by ID and rejects invalid page values', async () => {
  assert.equal((await hub.getModReleases(modId, undefined)).page, 1)
  assert.equal((await hub.getModReleases(modId, '2')).page, 2)
  assert.deepEqual(state.releaseCalls, [{ repository: 'owner/repo', page: 1 }, { repository: 'owner/repo', page: 2 }])
  for (const page of ['', '0', '-1', '1.2', '1e2', '1001', ['1', '2'], 'https://evil.test/repo']) {
    await assert.rejects(hub.getModReleases(modId, page), status(400))
  }
  await assert.rejects(hub.getModReleases(missingId, '1'), status(404))
  assert.equal(state.releaseCalls.length, 2)
})

test('commit lookups use the registered repository, preserve slash/Unicode branches and allow anonymous requests', async () => {
  assert.equal((await hub.getModCommits(modId, undefined)).branch, 'main')
  assert.equal((await hub.getModCommits(modId, '한글/패치')).branch, '한글/패치')
  const request = event('GET', `/api/mods/${modId}/commits?branch=feature%2Fdocs&repository=evil%2Frepo`)
  assert.equal((await routes.commits(request)).branch, 'feature/docs')
  assert.equal(request.node.res.getHeader('Cache-Control'), 'no-store')
  assert.deepEqual(state.commitCalls, [
    { repository: 'owner/repo', branch: undefined }, { repository: 'owner/repo', branch: '한글/패치' },
    { repository: 'owner/repo', branch: 'feature/docs' }
  ])
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.releaseCalls.length, 0)
  await assert.rejects(hub.getModCommits(missingId, 'main'), status(404))
  assert.equal(state.commitCalls.length, 3)
})

test('invalid commit IDs and branch query arrays or revision expressions fail before mod queries or GitHub', async () => {
  for (const id of ['0', '01', '-1', '9223372036854775808']) {
    await assert.rejects(hub.getModCommits(id, 'main'), status(400))
    await assert.rejects(routes.commits(event('GET', `/api/mods/${id}/commits?branch=main`)), status(400))
  }
  for (const branch of ['', 'main~1', 'main^', '../main', 'main@{1}', ['main', 'develop']]) {
    await assert.rejects(hub.getModCommits(modId, branch), status(400))
  }
  await assert.rejects(routes.commits(event('GET', `/api/mods/${modId}/commits?branch=main&branch=develop`)), status(400))
  assert.equal(state.sql.length, 0)
  assert.equal(state.commitCalls.length, 0)
})

test('public GET handlers disable caching and personalize canEdit from current session', async () => {
  for (const id of [null, 'owner', 'admin']) {
    if (id) signIn(id)
    else state.session = {}
    for (const key of ['list', 'detail']) {
      const request = event('GET', key === 'list' ? '/api/mods' : `/api/mods/${modId}`)
      const response = await routes[key](request)
      assert.equal(request.node.res.getHeader('Cache-Control'), 'no-store')
      const mod = response.mods?.[0] || response.mod
      assert.equal(mod.isOwner, id === 'owner')
      assert.equal(mod.canEdit, id === 'owner' || id === 'admin')
      assert.equal(mod.canDelete, id === 'owner' || id === 'admin')
    }
  }
  const request = event('GET', `/api/mods/${modId}/releases?page=2&repository=https://evil.test/repo`)
  assert.equal((await routes.releases(request)).page, 2)
  assert.equal(request.node.res.getHeader('Cache-Control'), 'no-store')
  assert.deepEqual(state.releaseCalls.at(-1), { repository: 'owner/repo', page: 2 })
})

test('numeric detail/update/release routes preserve exact IDs and reject unauthorized nonowners', async () => {
  const base = state.mods.get(modId)
  for (const id of [modId, unsafeIntegerModId, maxModId]) {
    const repository = `owner/repo-${id}`
    state.mods.set(id, { ...base, id, repository })
    const path = `/api/mods/${id}`
    signIn('owner')
    const detail = await routes.detail(event('GET', path))
    assert.equal(detail.mod.id, id)
    assert.equal(detail.mod.canEdit, true)
    const updated = await routes.update(event('PATCH', path, { name: `모드 ${id}` }))
    assert.equal(updated.id, id)
    assert.equal(updated.name, `모드 ${id}`)
    assert.equal(JSON.parse(JSON.stringify(updated)).id, id)
    assert.equal((await routes.releases(event('GET', `${path}/releases?page=2`))).page, 2)
    assert.deepEqual(state.releaseCalls.at(-1), { repository, page: 2 })
    const networkCalls = state.snapshotCalls.length
    for (const viewerId of ['other']) {
      signIn(viewerId)
      await assert.rejects(routes.update(event('PATCH', path, { repository: 'owner/new' })), status(403))
    }
    assert.equal(state.snapshotCalls.length, networkCalls)
    assert.equal(state.mods.get(id).repository, repository)
  }
})

test('numeric routes reject malformed and out-of-range IDs before mod queries', async () => {
  signIn('owner')
  for (const id of ['11111111-1111-4111-8111-111111111111', '0', '01', '-1', '1.5', '1e2', '1 ', '9223372036854775808']) {
    const path = `/api/mods/${encodeURIComponent(id)}`
    await assert.rejects(routes.detail(event('GET', path)), status(400))
    await assert.rejects(routes.update(event('PATCH', path, { name: '수정' })), status(400))
    await assert.rejects(routes.releases(event('GET', `${path}/releases`)), status(400))
  }
  assert.equal(state.sql.some(({ sql }) => /(?:FROM|UPDATE) mods/.test(sql)), false)
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.releaseCalls.length, 0)
  assert.equal(state.rateCalls.length, 0)
})

test('mutation handlers require a current DB account, rejecting anonymous/deleted sessions', async () => {
  for (const key of ['create', 'update']) {
    const method = key === 'create' ? 'POST' : 'PATCH'
    const path = key === 'create' ? '/api/mods' : `/api/mods/${modId}`
    state.session = {}
    await assert.rejects(routes[key](event(method, path, input)), error => status(401)(error) && /로그인/.test(error.message))
    signIn('owner')
    state.accounts.delete('owner')
    await assert.rejects(routes[key](event(method, path, input)), status(401))
    state.accounts.set('owner', { googleSub: 'owner', email: 'owner@example.test', handle: 'owner', role: 'user' })
  }
  assert.equal(state.snapshotCalls.length, 0)
})

test('mutation handlers enforce same-origin JSON request security for owners and admins', async () => {
  for (const userId of ['owner', 'admin']) {
    signIn(userId)
    for (const key of ['create', 'update']) {
      const method = key === 'create' ? 'POST' : 'PATCH'
      const path = key === 'create' ? '/api/mods' : `/api/mods/${modId}`
      await assert.rejects(routes[key](event(method, path, input, { origin: 'https://evil.test' })), error => status(403)(error) && /같은 사이트/.test(error.message))
      await assert.rejects(routes[key](event(method, path, input, { 'sec-fetch-site': 'cross-site' })), status(403))
      await assert.rejects(routes[key](event(method, path, input, { 'content-type': 'text/plain' })), status(415))
      await assert.rejects(routes[key](event(method, path, [], {})), error => status(400)(error) && /JSON 객체/.test(error.message))
    }
  }
  assert.equal(state.snapshotCalls.length, 0)
})

test('mutation routes ignore forged owner/admin flags and allow valid owner saves', async () => {
  signIn('other')
  await assert.rejects(routes.update(event('PATCH', `/api/mods/${modId}`, { ...input, created_by: 'admin', canEdit: true })), status(403))
  signIn('owner')
  const updated = await routes.update(event('PATCH', `/api/mods/${modId}`, { name: 'API 수정' }))
  assert.equal(updated.name, 'API 수정')
  const created = await routes.create(event('POST', '/api/mods', { ...input, repository: 'owner/new', created_by: 'admin' }))
  assert.equal(state.mods.get(created.id).createdBy, 'owner')
})

test('admins edit other users mods without taking ownership or changing attribution', async () => {
  signIn('admin')
  const updated = await routes.update(event('PATCH', `/api/mods/${modId}`, {
    name: '관리자가 수정한 모드', created_by: 'admin', isOwner: true
  }))
  assert.equal(updated.name, '관리자가 수정한 모드')
  assert.equal(updated.authorHandle, 'owner')
  assert.equal(updated.authorRole, 'user')
  assert.equal(updated.isOwner, false)
  assert.equal(updated.canEdit, true)
  assert.equal(updated.canDelete, true)
  assert.equal(state.mods.get(modId).createdBy, 'owner')
  assert.equal(state.snapshotCalls.length, 0)
})

test('forged or stale admin sessions cannot edit or delete another users mod', async () => {
  signIn('other')
  state.session.user.role = 'admin'
  await assert.rejects(routes.update(event('PATCH', `/api/mods/${modId}`, { name: '권한 위조', role: 'admin', canEdit: true })), status(403))
  assert.equal(state.session.user.role, 'user')
  state.session.user.role = 'admin'
  await assert.rejects(routes.delete(event('DELETE', `/api/mods/${modId}`, { userId: 'owner', role: 'admin', canDelete: true })), status(403))
  state.accounts.get('admin').role = 'user'
  signIn('admin')
  state.session.user.role = 'admin'
  await assert.rejects(routes.delete(event('DELETE', `/api/mods/${modId}`)), status(403))
  assert.equal(state.mods.get(modId).name, input.name)
  assert.equal(state.sql.some(({ sql }) => /^(UPDATE|DELETE)/.test(sql)), false)
  assert.equal(state.rateCalls.length, 0)
})

test('admin role revocation during repository validation prevents the final update', async () => {
  state.onSnapshot = () => {
    state.accounts.get('admin').role = 'user'
  }
  await assert.rejects(hub.updateMod('admin', modId, { repository: 'owner/new', name: '권한 회수 후 수정' }), status(403))
  assert.equal(state.mods.get(modId).repository, input.repository)
  assert.equal(state.mods.get(modId).name, input.name)
})

test('owners and admins can delete offline and release the repository for a fresh numeric registration', async () => {
  for (const actorId of ['owner', 'admin']) {
    if (!state.mods.has(modId)) state.mods.set(modId, { ...input, id: modId, createdBy: 'owner', createdAt: new Date(), updatedAt: new Date() })
    state.githubError = new Error('GitHub outage')
    assert.deepEqual(await hub.deleteMod(actorId, modId), { id: modId, deleted: true })
    assert.equal(state.mods.has(modId), false)
    await assert.rejects(hub.getModDetail(modId), status(404))
    await assert.rejects(hub.getModReleases(modId, '1'), status(404))
  }
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.releaseCalls.length, 0)
  assert.equal(state.rateCalls.length, 2)
  state.githubError = null
  const registered = await hub.createMod('owner', input)
  assert.equal(registered.id, '2')
  assert.equal(registered.isOwner, true)
  assert.equal(registered.canDelete, true)
})

test('nonowners, missing users, missing mods and invalid IDs cannot delete registrations', async () => {
  for (const actorId of ['other', 'missing-user']) {
    await assert.rejects(hub.deleteMod(actorId, modId), status(403))
  }
  await assert.rejects(hub.deleteMod('owner', missingId), status(404))
  const reads = state.sql.length
  for (const id of ['0', '01', '-1', '1.0', '9223372036854775808', null]) {
    await assert.rejects(hub.deleteMod('owner', id), status(400))
  }
  assert.equal(state.sql.length, reads)
  assert.equal(state.sql.some(({ sql }) => sql.startsWith('DELETE')), false)
  assert.equal(state.rateCalls.length, 0)
  assert.equal(state.mods.size, 1)
})

test('final delete predicate rechecks ownership, current admin role and account existence', async () => {
  state.onDelete = () => {
    state.mods.get(modId).createdBy = 'other'
  }
  await assert.rejects(hub.deleteMod('owner', modId), status(403))
  state.onDelete = () => {
    state.accounts.get('admin').role = 'user'
  }
  await assert.rejects(hub.deleteMod('admin', modId), status(403))
  state.accounts.get('admin').role = 'admin'
  state.onDelete = () => {
    state.accounts.delete('admin')
  }
  await assert.rejects(hub.deleteMod('admin', modId), status(403))
  assert.equal(state.mods.has(modId), true)
})

test('delete handlers reject anonymous or deleted sessions and cross-origin or oversized requests', async () => {
  await assert.rejects(routes.delete(event('DELETE', `/api/mods/${modId}`)), status(401))
  signIn('other')
  state.accounts.delete('other')
  await assert.rejects(routes.delete(event('DELETE', `/api/mods/${modId}`)), status(401))
  for (const actorId of ['owner', 'admin']) {
    signIn(actorId)
    for (const headers of [{ origin: 'https://evil.test' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
      await assert.rejects(routes.delete(event('DELETE', `/api/mods/${modId}`, undefined, headers)), status(403))
    }
    await assert.rejects(routes.delete(event('DELETE', `/api/mods/${modId}`, undefined, { 'content-length': '131073' })), status(413))
    await assert.rejects(routes.delete(event('DELETE', `/api/mods/${modId}`, undefined, { 'content-length': '-1' })), status(400))
  }
  assert.equal(state.mods.size, 1)
  assert.equal(state.sql.some(({ sql }) => sql.startsWith('DELETE')), false)
  assert.equal(state.rateCalls.length, 0)
})

test('bodyless delete routes return exact bigint IDs and keep personalized responses uncached', async () => {
  const base = state.mods.get(modId)
  signIn('owner')
  for (const id of [modId, unsafeIntegerModId, maxModId]) {
    state.mods.set(id, { ...base, id, repository: `owner/mod-${id}` })
    const request = event('DELETE', `/api/mods/${id}`)
    delete request.node.req.headers['content-type']
    assert.deepEqual(await routes.delete(request), { id, deleted: true })
    assert.equal(request.node.res.getHeader('Cache-Control'), 'no-store')
    assert.equal(state.mods.has(id), false)
    await assert.rejects(routes.delete(event('DELETE', `/api/mods/${id}`)), status(404))
  }
})

test('current DB promotion grants admin permissions even if the session still says user', async () => {
  signIn('other')
  state.accounts.get('other').role = 'admin'
  const updated = await routes.update(event('PATCH', `/api/mods/${modId}`, { name: '새 관리자 수정' }))
  assert.equal(updated.isOwner, false)
  assert.equal(updated.canEdit, true)
  assert.equal(state.session.user.role, 'admin')
  assert.deepEqual(await routes.delete(event('DELETE', `/api/mods/${modId}`)), { id: modId, deleted: true })
})

test('account deletion reassigns mods to the same anonymous ID before removing account', async () => {
  const queries = []
  let began = false
  const transaction = async (strings, ...values) => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim()
    queries.push({ sql, values })
    if (sql.startsWith('SELECT')) return [{ role: 'user' }]
    if (sql.startsWith('DELETE FROM app_users')) return [{ googleSub: 'owner' }]
    return []
  }
  state.database = {
    async begin(operation) {
      began = true
      await operation(transaction)
    }
  }
  await deleteUserAccount('owner')
  assert.equal(began, true)
  const notices = queries.find(({ sql }) => sql.startsWith('UPDATE notices'))
  const mods = queries.find(({ sql }) => sql.startsWith('UPDATE mods'))
  const deletedId = mods.values[0]
  assert.match(deletedId, /^deleted:[0-9a-f-]{36}$/)
  assert.deepEqual(mods.values, [notices.values[0], 'owner'])
  assert.match(mods.sql, /SET created_by = \? WHERE created_by = \?$/)
  assert.equal(queries.at(-1).sql, 'DELETE FROM app_users WHERE google_sub = ? RETURNING google_sub AS "googleSub"')
  assert.equal(queries.some(({ sql }) => sql.startsWith('DELETE FROM mods')), false)
})

test('HTML session refresh preserves session data and throttles rotation to one day', async (context) => {
  let now = Date.UTC(2026, 9, 23)
  context.mock.method(Date, 'now', () => now)
  signIn('owner')
  state.refreshCalls = []
  state.session = { ...state.session, id: 'original-session', loggedInAt: 123, secure: { provider: 'google' } }
  const original = { ...state.session }
  const request = () => event('GET', '/', undefined, { accept: 'text/html', cookie: 'nuxt-session=sealed' })
  await sessionRefreshMiddleware(request())
  assert.deepEqual(state.refreshCalls, [{
    user: original.user,
    loggedInAt: 123,
    secure: { provider: 'google' },
    refreshedAt: now
  }])
  now += 24 * 60 * 60 * 1000 - 1
  await sessionRefreshMiddleware(request())
  assert.equal(state.refreshCalls.length, 1)
  now++
  await sessionRefreshMiddleware(request())
  assert.equal(state.refreshCalls.length, 2)
  assert.equal(state.refreshCalls[1].refreshedAt, now)
  assert.equal(state.session.loggedInAt, 123)
  assert.deepEqual(state.session.secure, original.secure)
})

test('session refresh ignores API requests, non-GET requests and anonymous sessions', async () => {
  state.refreshCalls = []
  signIn('owner')
  for (const request of [
    event('GET', '/api/mods'),
    event('POST', '/', undefined, { accept: 'text/html', cookie: 'nuxt-session=sealed' }),
    event('GET', '/', undefined, { accept: 'text/html' })
  ]) {
    await sessionRefreshMiddleware(request)
  }
  state.session = {}
  await sessionRefreshMiddleware(event('GET', '/', undefined, { accept: 'text/html', cookie: 'nuxt-session=sealed' }))
  assert.deepEqual(state.refreshCalls, [])
})

test('session user synchronization retains unrelated session values', async () => {
  const { syncSessionUser } = await import(authUrl)
  signIn('owner')
  state.session = { ...state.session, id: 'session', loggedInAt: 123, refreshedAt: 456, secure: { token: 'retained' } }
  const account = { ...state.accounts.get('owner'), handle: 'UpdatedHandle' }
  await syncSessionUser(event('PATCH', '/api/profile'), account)
  assert.deepEqual(state.session, {
    id: 'session',
    user: { id: account.googleSub, email: account.email, handle: 'UpdatedHandle', role: account.role },
    loggedInAt: 123,
    refreshedAt: 456,
    secure: { token: 'retained' }
  })
})

test('shared page validation rejects malformed and out-of-range historical pages', async () => {
  const { parsePage } = await import(validationUrl)
  assert.equal(parsePage(undefined, 'Invalid page'), 1)
  assert.equal(parsePage('', 'Invalid page'), 1)
  assert.equal(parsePage('2', 'Invalid page'), 2)
  assert.equal(parsePage('100000', 'Invalid page'), 100000)
  for (const page of ['2abc', '0', '-1', '1.5', '100001']) {
    assert.throws(() => parsePage(page, 'Invalid page'), status(400))
  }
})

test('request error codes stay internal and do not add response JSON fields', async () => {
  const { readJsonBody, getRequestErrorCode } = await import(securityUrl)
  await assert.rejects(readJsonBody(event('POST', '/api/mods', {}, { 'content-type': 'text/plain' })), (error) => {
    assert.equal(error.statusCode, 415)
    assert.equal(error.statusMessage, 'JSON request body is required')
    assert.equal(getRequestErrorCode(error), 'JSON_REQUIRED')
    assert.equal(error.data, undefined)
    assert.equal('code' in error.toJSON(), false)
    return true
  })
})
