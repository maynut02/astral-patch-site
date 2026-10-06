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
globalThis.__modHubTest = {
  getDatabase: () => state.database,
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
  async isRateLimited(database, bucketKey, windows) {
    assert.equal(database, state.database)
    state.rateCalls.push({ bucketKey, windows })
    return state.limited
  }
}

const databaseUrl = moduleUrl('export const getDatabase = () => globalThis.__modHubTest.getDatabase()')
const githubUrl = await transformModule('server/utils/mod-github.ts')
const githubMockUrl = moduleUrl(`
  export { normalizeModRepository } from ${JSON.stringify(githubUrl)}
  export const getModGitHubSnapshot = (...args) => globalThis.__modHubTest.getModGitHubSnapshot(...args)
  export const getModGitHubReleases = (...args) => globalThis.__modHubTest.getModGitHubReleases(...args)
`)
const rateUrl = moduleUrl('export const isRateLimited = (...args) => globalThis.__modHubTest.isRateLimited(...args)')
const validationUrl = await transformModule('server/utils/validation.ts')
const typesUrl = await transformModule('shared/types/mod.ts')
const hubUrl = await transformModule('server/utils/mod-hub.ts', {
  '#shared/types/mod': typesUrl,
  './database': databaseUrl,
  './mod-github': githubMockUrl,
  './rate-limiter': rateUrl,
  './validation': validationUrl
})
const hub = await import(hubUrl)
const authUrl = await transformModule('server/utils/auth-user.ts', { './database': databaseUrl })
const securityUrl = await transformModule('server/utils/request-security.ts')
const accountUrl = await transformModule('server/utils/user-account.ts', { './database': databaseUrl, './auth-user': authUrl })
const { deleteUserAccount } = await import(accountUrl)
const routes = {}
for (const [key, path, prefix] of [
  ['list', 'server/api/mods.get.ts', '../utils/'],
  ['create', 'server/api/mods.post.ts', '../utils/'],
  ['detail', 'server/api/mods/[id].get.ts', '../../utils/'],
  ['update', 'server/api/mods/[id].patch.ts', '../../utils/'],
  ['releases', 'server/api/mods/[id]/releases.get.ts', '../../../utils/']
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
  return {
    ...mod,
    authorHandle: author?.handle ?? null,
    authorRole: author?.role ?? 'user',
    canEdit: mod.createdBy === viewerId,
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
      // Ownership is computed by SQL; it never depends on a supplied role.
      assert.match(sql, /COALESCE\(m\.created_by = \?, false\) AS "canEdit"/)
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
      assert.match(sql, /WHERE id = \? AND created_by = \? RETURNING id$/)
      const [name, summary, description, repository, platforms, id, ownerId] = values
      if (state.onUpdate) await state.onUpdate()
      const mod = state.mods.get(id)
      if (!mod || mod.createdBy !== ownerId) return []
      if ([...state.mods.values()].some(other => other.id !== id && other.repository.toLowerCase() === repository.toLowerCase())) {
        throw Object.assign(new Error('unique repository'), { code: '23505' })
      }
      Object.assign(mod, { name, summary, description, repository, platforms, updatedAt: new Date() })
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
    sql: [], snapshotCalls: [], releaseCalls: [], rateCalls: [], session: {}, limited: false
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
  const id = pathname.match(/^\/api\/mods\/([^/]+)(?:\/releases)?$/)?.[1]
  result.context.params = id === undefined ? {} : { id: decodeURIComponent(id) }
  return result
}

function status(code) {
  return error => error.statusCode === code
}

test('public list is bounded, private identities are omitted, only owner canEdit', async () => {
  for (const viewerId of [null, 'owner', 'other', 'admin']) {
    const response = await hub.getMods(viewerId)
    assert.equal(response.mods[0].canEdit, viewerId === 'owner')
    assert.equal(response.mods[0].createdAt, '2026-01-01T00:00:00.000Z')
    for (const key of ['googleSub', 'createdBy', 'created_by', 'email', 'ownerId']) {
      assert.equal(key in response.mods[0], false)
    }
    assert.equal(state.sql.at(-1).values.at(-1), 200)
  }
  assert.equal(state.snapshotCalls.length, 0)
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

test('nonowner and admin cannot edit and are rejected before validation or network', async () => {
  for (const userId of ['other', 'admin']) {
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
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.sql.some(({ sql }) => /^(INSERT|UPDATE)/.test(sql)), false)
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

test('public GET handlers disable caching and personalize canEdit from current session', async () => {
  for (const id of [null, 'owner', 'admin']) {
    if (id) signIn(id)
    else state.session = {}
    for (const key of ['list', 'detail']) {
      const request = event('GET', key === 'list' ? '/api/mods' : `/api/mods/${modId}`)
      const response = await routes[key](request)
      assert.equal(request.node.res.getHeader('Cache-Control'), 'no-store')
      assert.equal((response.mods?.[0] || response.mod).canEdit, id === 'owner')
    }
  }
  const request = event('GET', `/api/mods/${modId}/releases?page=2&repository=https://evil.test/repo`)
  assert.equal((await routes.releases(request)).page, 2)
  assert.equal(request.node.res.getHeader('Cache-Control'), 'no-store')
  assert.deepEqual(state.releaseCalls.at(-1), { repository: 'owner/repo', page: 2 })
})

test('numeric detail/update/release routes preserve exact IDs and owner-only access', async () => {
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
    for (const viewerId of ['other', 'admin']) {
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
  signIn('admin')
  await assert.rejects(routes.update(event('PATCH', `/api/mods/${modId}`, { ...input, created_by: 'admin', canEdit: true })), status(403))
  signIn('owner')
  const updated = await routes.update(event('PATCH', `/api/mods/${modId}`, { name: 'API 수정' }))
  assert.equal(updated.name, 'API 수정')
  const created = await routes.create(event('POST', '/api/mods', { ...input, repository: 'owner/new', created_by: 'admin' }))
  assert.equal(state.mods.get(created.id).createdBy, 'owner')
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
