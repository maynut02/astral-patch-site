import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import postgres from 'postgres'
import ts from 'typescript'
import { renderBaseGlossarySql, BASE_GLOSSARY_ID, PUBLIC_TRANSLATION_ORIGIN } from './base-glossary-sql.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const nuxtRequire = createRequire(require.resolve('nuxt/package.json'))
const h3 = await import(pathToFileURL(nuxtRequire.resolve('h3')).href)
const databaseUrl = process.env.TEST_DATABASE_URL
const vue = nuxtRequire('vue')

function modules(database, globals = {}, overrides = new Map()) {
  const cache = new Map()
  function load(filename) {
    filename = path.resolve(root, filename)
    if (overrides.has(filename)) return overrides.get(filename)
    if (filename === path.join(root, 'server/utils/database.ts')) return { getDatabase: () => database }
    if (filename === path.join(root, 'server/utils/auth-user.ts')) return { getCurrentSessionUser: async () => null }
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(code, {
      module, exports: module.exports, Date, console, ...globals, defineEventHandler: h3.defineEventHandler,
      require(specifier) {
        if (specifier === 'h3') return h3
        if (specifier.startsWith('node:')) return require(specifier)
        let target = specifier.startsWith('#shared/') ? path.join(root, 'shared', specifier.slice(8)) : specifier.startsWith('~/') ? path.join(root, 'app', specifier.slice(2)) : path.resolve(path.dirname(filename), specifier)
        if (!existsSync(target) || !statSync(target).isFile()) target += '.ts'
        return load(target)
      }
    }, { filename })
    return module.exports
  }
  return { load, shared: load('shared/utils/glossary.ts'), validation: load('server/utils/editor-dictionary/glossary.ts') }
}

const pure = modules(null)
const metadata = overrides => ({ ...pure.shared.emptyGlossaryMetadata(), chineseSimplified: '星币', ...overrides })
const proposalInput = overrides => ({ translation: '스타 코인', note: '기본 재화를 지칭합니다.', metadata: metadata(), changeKind: 'new', ...overrides })
const author = { id: 'author', role: 'user' }
const reviewer = { id: 'reviewer', role: 'verified' }
const outsider = { id: 'outsider', role: 'user' }

test('glossary: Chinese-only terms and bounded variants are validated', () => {
  const parsed = pure.validation.parseGlossaryMetadata(metadata())
  assert.equal(parsed.japanese, '')
  assert.equal(parsed.chineseSimplified, '星币')
  assert.throws(() => pure.validation.parseGlossaryMetadata(metadata({ chineseSimplified: '' })), error => error.statusCode === 400)
  assert.throws(() => pure.validation.parseGlossaryMetadata(metadata({ historical: Array(11).fill('과거') })), error => error.statusCode === 400)
  assert.throws(() => pure.validation.parseGlossaryMetadata(metadata({ semanticReview: 'recorded' })), error => error.statusCode === 400)
})

test('glossary: scope and semantic review accept only exact allowed strings, with defaults only when omitted', () => {
  const omitted = metadata()
  delete omitted.scope
  delete omitted.semanticReview
  const defaults = pure.validation.parseGlossaryMetadata(omitted)
  assert.equal(defaults.scope, 'project')
  assert.equal(defaults.semanticReview, 'unrecorded')
  for (const scope of ['project', 'file', 'entry', 'character']) {
    assert.equal(pure.validation.parseGlossaryMetadata(metadata({ scope, target: 'STRFixture_1' })).scope, scope)
  }
  for (const semanticReview of ['unrecorded', 'recorded', 'unresolved']) {
    assert.equal(pure.validation.parseGlossaryMetadata(metadata({ semanticReview, semanticNote: '검토 근거' })).semanticReview, semanticReview)
  }
  for (const [field, allowed] of [['scope', 'project'], ['semanticReview', 'unresolved']]) {
    for (const value of [[allowed], [], null, {}, 1, true, { toString: () => allowed }]) {
      assert.throws(() => pure.validation.parseGlossaryMetadata(metadata({ [field]: value })), error => error.statusCode === 400)
    }
  }
})

test('glossary: source matching respects language, markup and scope without mutating text', () => {
  const source = { jp: '', cnS: '星币を得る', cnT: '', category: 'STRTest', unitKey: '1' }
  const before = JSON.stringify(source)
  assert.equal(pure.shared.glossarySourceMatches(metadata(), source), true)
  assert.equal(pure.shared.glossarySourceMatches(metadata({ scope: 'file', target: 'OTHER' }), source), false)
  assert.equal(pure.shared.glossarySourceMatches(metadata({ scope: 'character', target: '렌' }), source), false)
  assert.equal(pure.shared.glossarySourceMatches(metadata(), { ...source, cnS: '[color=星币]{星币}<img src="星币">' }), false)
  assert.equal(JSON.stringify(source), before)
})

test('glossary: held proposals require resume and terminal proposals cannot be applied again', () => {
  assert.equal(pure.shared.glossaryNextStatus('held', 'approve'), null)
  assert.equal(pure.shared.glossaryNextStatus('held', 'resume'), 'pending')
  assert.equal(pure.shared.glossaryNextStatus('approved', 'approve'), null)
  assert.equal(pure.shared.glossaryNextStatus('pending', 'hold'), 'held')
})

const { getGlossarySourceSegments } = pure.load('app/utils/editor-glossary-segments.ts')
const inlineEntry = (id, japanese, overrides = {}) => ({ id, metadata: metadata({ japanese, ...overrides }) })

test('glossary inline: match only the displayed source language and preserve literal expressions', () => {
  const entries = [inlineEntry('one', 'コイン.*')]
  assert.equal(getGlossarySourceSegments('コイン.* + コイン', entries, 'jp').filter(part => part.type === 'term').length, 1)
  assert.equal(getGlossarySourceSegments('コイン.*', entries, 'cnS').some(part => part.type === 'term'), false)
  assert.equal(getGlossarySourceSegments('星币', entries, 'cnS')[0].type, 'term')
  assert.equal(getGlossarySourceSegments('星币', entries, 'en')[0].type, 'text')
})

test('glossary inline: prefer the longest overlap and retain every rule for the same expression', () => {
  const entries = [inlineEntry('short', '会心'), inlineEntry('long', '会心ダメージ'), inlineEntry('alternative', '会心ダメージ'), inlineEntry('damage', 'ダメージ')]
  const source = '会心ダメージ + ダメージ + 会心ダメージ'
  const parts = getGlossarySourceSegments(source, entries, 'jp')
  const terms = parts.filter(part => part.type === 'term')
  assert.equal(parts.map(part => part.content).join(''), source)
  assert.deepEqual(Array.from(terms, part => part.content), ['会心ダメージ', 'ダメージ', '会心ダメージ'])
  assert.deepEqual(Array.from(terms[0].entries, entry => entry.id), ['long', 'alternative'])
})

test('glossary inline: tags, variables and Astral reference payloads remain untouched', () => {
  const source = '[color=コイン]コイン[/color] {コイン} <tag value="コイン">コイン [Astral=Card:123][/Astral]'
  const parts = getGlossarySourceSegments(source, [inlineEntry('coin', 'コイン'), inlineEntry('id', '123')], 'jp')
  assert.equal(parts.map(part => part.content).join(''), source)
  assert.equal(parts.filter(part => part.type === 'term').length, 2)
  assert.equal(getGlossarySourceSegments('コ[color=red]イ[/color]ン', [inlineEntry('coin', 'コイン')], 'jp').some(part => part.type === 'term'), false)
})

test('glossary inline: NFC matching preserves original combining characters and emoji offsets', () => {
  const source = '👩‍💻 cafe\u0301 + café'
  const parts = getGlossarySourceSegments(source, [inlineEntry('accent', 'café')], 'jp')
  assert.equal(parts.map(part => part.content).join(''), source)
  assert.deepEqual(Array.from(parts.filter(part => part.type === 'term'), part => part.content), ['cafe\u0301', 'café'])
})

test('glossary inline: archived terms and voice cards are excluded', () => {
  const parts = getGlossarySourceSegments('コイン', [inlineEntry('archived', 'コイン', { archived: true }), inlineEntry('voice', 'コイン', { kind: 'voice' })], 'jp')
  assert.equal(parts.some(part => part.type === 'term'), false)
  assert.equal(parts.map(part => part.content).join(''), 'コイン')
})

async function flushClient() {
  await vue.nextTick()
  await new Promise(resolve => setImmediate(resolve))
}

function clientHarness(context, fetch, query = {}) {
  const route = vue.reactive({ query })
  const routerReplacements = []
  const scope = vue.effectScope()
  const unmount = []
  context.after(() => {
    for (const callback of unmount) callback()
    scope.stop()
  })
  const list = { dictionaries: vue.ref([]), dictionariesStatus: vue.ref('success'), dictionariesError: vue.ref(''), loadDictionaries: async () => {} }
  const globals = {
    ref: vue.ref, shallowRef: vue.shallowRef, computed: vue.computed, watch: vue.watch, onMounted: () => {}, onUnmounted: callback => unmount.push(callback),
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    useRoute: () => route,
    useRouter: () => ({
      replace: async ({ query }) => {
        routerReplacements.push(query)
        route.query = query
      }
    }),
    useUserSession: () => ({ loggedIn: vue.ref(true), user: vue.ref({ role: 'verified' }) }),
    useAppToast: () => ({ showLoginRequiredToast: () => {} }),
    $fetch: fetch
  }
  const loader = modules(null, globals, new Map([[path.join(root, 'app/composables/editor-dictionaries.ts'), { useEditorDictionaryList: () => list }]]))
  return { route, routerReplacements, list, create: (file, method, ...args) => scope.run(() => loader.load(file)[method](...args)) }
}

test('glossary client: a review decision stays bound to its captured proposal after selection changes', async (context) => {
  const calls = []
  const h = clientHarness(context, async (url, options) => {
    calls.push({ url, options })
    return { proposals: [], entries: [], total: 0, page: 1, totalPages: 1 }
  }, { dictionary: 'team', tab: 'proposals' })
  const workspace = h.create('app/composables/glossary-workspace.ts', 'useGlossaryWorkspace')
  const original = { id: 'original', dictionaryId: 'team', entryId: null }
  workspace.selectedProposal.value = original
  const target = workspace.selectedProposal.value
  workspace.selectedProposal.value = { ...original, id: 'other' }
  await workspace.decide('hold', '검토 필요', target)
  assert.equal(calls.find(call => call.options?.method === 'PATCH').url, '/api/editor/dictionaries/team/proposals/original')
})

test('glossary client: pagination clears a previous entry link and selects a result on the new page', async (context) => {
  const h = clientHarness(context, async () => ({ entries: [{ id: 'page-two' }], total: 60, page: 2, totalPages: 2 }), { dictionary: 'team', tab: 'term', entry: 'page-one' })
  const workspace = h.create('app/composables/glossary-workspace.ts', 'useGlossaryWorkspace')
  workspace.page.value = 2
  await flushClient()
  assert.equal(h.route.query.entry, undefined)
  assert.equal(h.route.query.page, 2)
  assert.equal(workspace.selection.value.id, 'page-two')
})

test('glossary client: a saved review remains successful when only the list refresh fails', async (context) => {
  const h = clientHarness(context, async (url, options) => {
    if (options?.method === 'PATCH') return { status: 'held' }
    throw new Error('List refresh failed')
  }, { dictionary: 'team', tab: 'proposals' })
  const workspace = h.create('app/composables/glossary-workspace.ts', 'useGlossaryWorkspace')
  workspace.selectedProposal.value = { id: 'proposal', dictionaryId: 'team', entryId: null }
  assert.equal(await workspace.decide('hold', '검토 필요'), true)
  assert.equal(workspace.error.value, 'List refresh failed')
  assert.equal(workspace.deciding.value, false)
})

test('glossary client: proposal filter and page are restored from the URL', async (context) => {
  const h = clientHarness(context, async () => ({ proposals: [], total: 0, page: 1, totalPages: 1 }), { dictionary: 'team', tab: 'proposals', status: 'held', page: '2' })
  const workspace = h.create('app/composables/glossary-workspace.ts', 'useGlossaryWorkspace')
  assert.equal(workspace.statusFilter.value, 'held')
  assert.equal(workspace.page.value, 2)
  workspace.statusFilter.value = 'approved'
  await flushClient()
  assert.equal(h.route.query.status, 'approved')
  assert.equal(h.route.query.page, undefined)
})

test('glossary client: entry history survives refresh and a fresh deep link without losing proposal records', async (context) => {
  const linked = { id: 'linked', dictionaryId: 'team', metadata: metadata() }
  const records = ['old', 'middle', 'latest'].map(id => ({ id, entryId: linked.id, dictionaryId: 'team' }))
  for (let visit = 0; visit < 2; visit++) {
    let historyLoads = 0
    const h = clientHarness(context, async (url, options) => {
      if (url.endsWith('/entries/linked')) return linked
      if (url.endsWith('/proposals')) {
        assert.equal(options.query.entryId, linked.id)
        historyLoads++
        return { proposals: records, total: records.length, page: 1, totalPages: 1 }
      }
      return { entries: [], total: 0, page: 1, totalPages: 1 }
    }, { dictionary: 'team', tab: 'term', entry: 'linked', detail: 'history' })
    h.list.dictionaries.value = [{ id: 'team', isTeam: true }]
    const workspace = h.create('app/composables/glossary-workspace.ts', 'useGlossaryWorkspace')
    await workspace.init()
    assert.equal(workspace.selection.value.id, linked.id)
    assert.equal(workspace.detail.value, 'history')
    assert.deepEqual(Array.from(workspace.history.value, proposal => proposal.id), ['old', 'middle', 'latest'])
    await workspace.load()
    assert.equal(historyLoads, 2)
    assert.deepEqual(Array.from(workspace.history.value, proposal => proposal.id), ['old', 'middle', 'latest'])
    assert.equal(h.route.query.entry, 'linked')
    assert.equal(h.route.query.detail, 'history')
  }
})

test('glossary client: late history replies cannot refill another entry or a different detail tab', async (context) => {
  const replies = []
  const h = clientHarness(context, () => new Promise(resolve => replies.push(resolve)), { dictionary: 'team', tab: 'term' })
  const workspace = h.create('app/composables/glossary-workspace.ts', 'useGlossaryWorkspace')
  const first = { id: 'first', dictionaryId: 'team', metadata: metadata() }
  const second = { ...first, id: 'second' }
  await workspace.selectEntry(first)
  const oldHistory = workspace.showHistory()
  await flushClient()
  assert.equal(h.route.query.detail, 'history')
  await workspace.selectEntry(second)
  replies[0]({ proposals: [{ id: 'first-history' }], total: 1, page: 1, totalPages: 1 })
  await oldHistory
  assert.equal(workspace.detail.value, 'overview')
  assert.equal(workspace.history.value.length, 0)
  const secondHistory = workspace.showHistory()
  await flushClient()
  await workspace.showDetail('usage')
  replies[1]({ proposals: [{ id: 'second-history' }], total: 1, page: 1, totalPages: 1 })
  await secondHistory
  assert.equal(workspace.detail.value, 'usage')
  assert.equal(workspace.history.value.length, 0)
  assert.equal(h.route.query.detail, 'usage')
  await workspace.showDetail('overview')
  assert.equal(h.route.query.detail, undefined)
  assert.equal(h.route.query.entry, second.id)
})

test('glossary client: filters and search reset linked detail with exactly one list request', async (context) => {
  const calls = []
  const h = clientHarness(context, async (url, options) => {
    calls.push({ url, options })
    return { entries: [{ id: 'visible', dictionaryId: 'team', metadata: metadata() }], total: 60, page: options.query.page, totalPages: 2 }
  }, { dictionary: 'team', tab: 'term', page: '2', entry: 'old', detail: 'history' })
  const workspace = h.create('app/composables/glossary-workspace.ts', 'useGlossaryWorkspace')
  workspace.archived.value = true
  await flushClient()
  assert.equal(calls.length, 1)
  assert.equal(workspace.page.value, 1)
  assert.equal(workspace.detail.value, 'overview')
  for (const key of ['entry', 'detail', 'page']) assert.equal(h.route.query[key], undefined)
  workspace.page.value = 2
  await flushClient()
  assert.equal(calls.length, 2)
  workspace.search.value = '새 검색'
  await workspace.runSearch()
  await flushClient()
  assert.equal(calls.length, 3)
  assert.equal(workspace.page.value, 1)
  assert.equal(h.route.query.q, '새 검색')
})

test('glossary client: external URL changes restore the linked entry and history detail', async (context) => {
  const first = { id: 'first', dictionaryId: 'team', metadata: metadata() }
  const second = { ...first, id: 'second' }
  const h = clientHarness(context, async (url, options) => {
    if (url.endsWith('/proposals')) return { proposals: [{ id: 'history', entryId: options.query.entryId }], total: 1, page: 1, totalPages: 1 }
    return { entries: [first, second], total: 2, page: 1, totalPages: 1 }
  }, { dictionary: 'team', tab: 'term', entry: 'first' })
  const workspace = h.create('app/composables/glossary-workspace.ts', 'useGlossaryWorkspace')
  await workspace.load()
  h.route.query = { dictionary: 'team', tab: 'term', entry: 'second', detail: 'history' }
  await flushClient()
  assert.equal(workspace.selection.value.id, second.id)
  assert.equal(workspace.detail.value, 'history')
  assert.equal(workspace.history.value[0].entryId, second.id)
})

test('glossary client: an embedded workspace opens linked history without touching the host URL', async (context) => {
  const first = { id: 'first', dictionaryId: 'team', metadata: metadata() }
  const second = { ...first, id: 'second' }
  const hostQuery = { item: 'STRItem_1', page: '3' }
  const h = clientHarness(context, async (url, options) => {
    if (url.endsWith('/proposals')) return { proposals: [{ id: 'history', entryId: options.query.entryId }], total: 1, page: 1, totalPages: 1 }
    return { entries: [first, second], total: 2, page: 1, totalPages: 1 }
  }, { ...hostQuery })
  h.list.dictionaries.value = [{ id: 'team', isTeam: true }]
  const workspace = h.create('app/composables/glossary-workspace.ts', 'useGlossaryWorkspace', { syncRoute: false })
  await workspace.open({ dictionary: 'team', tab: 'term', entry: 'second', detail: 'history' })
  assert.equal(workspace.selection.value.id, second.id)
  assert.equal(workspace.detail.value, 'history')
  assert.equal(workspace.history.value[0].entryId, second.id)
  await workspace.selectEntry(first)
  workspace.page.value = 2
  await flushClient()
  assert.deepEqual(h.routerReplacements, [])
  assert.deepEqual({ ...h.route.query }, hostQuery)
  assert.equal(workspace.locationQuery.value.page, 2)
  assert.equal(workspace.locationQuery.value.dictionary, 'team')
})

test('glossary client: refreshing the same source retains references, while a new version clears them and ignores old replies', async (context) => {
  const replies = []
  const h = clientHarness(context, () => new Promise(resolve => replies.push(resolve)))
  const item = vue.ref({ id: 'item', sourceVersionId: 'one' })
  const state = h.create('app/composables/editor-glossary-context.ts', 'useEditorGlossaryContext', vue.computed(() => item.value))
  replies[0]({ entries: [{ id: 'old' }], voices: [] })
  await flushClient()
  const refresh = state.refreshGlossary()
  assert.equal(state.glossaryEntries.value[0].id, 'old')
  item.value = { id: 'item', sourceVersionId: 'two' }
  await flushClient()
  assert.equal(state.glossaryEntries.value.length, 0)
  replies[1]({ entries: [{ id: 'stale' }], voices: [] })
  await refresh
  assert.equal(state.glossaryEntries.value.length, 0)
  replies[2]({ entries: [{ id: 'current' }], voices: [] })
  await flushClient()
  assert.equal(state.glossaryEntries.value[0].id, 'current')
  assert.equal(state.glossaryLoading.value, false)
})

test('glossary client: a failed refresh clears retained guidance and allows retry', async (context) => {
  let failed = false
  const h = clientHarness(context, async () => {
    if (failed) throw new Error('Network unavailable')
    return { entries: [{ id: 'term' }], voices: [] }
  })
  const state = h.create('app/composables/editor-glossary-context.ts', 'useEditorGlossaryContext', vue.computed(() => ({ id: 'item', sourceVersionId: 'one' })))
  await flushClient()
  failed = true
  await state.refreshGlossary()
  assert.equal(state.glossaryEntries.value.length, 0)
  assert.equal(state.glossaryFailed.value, true)
  failed = false
  await state.refreshGlossary()
  assert.equal(state.glossaryEntries.value[0].id, 'term')
  assert.equal(state.glossaryFailed.value, false)
})

function integration(name, operation) {
  test(name, {
    skip: databaseUrl ? false : 'Set TEST_DATABASE_URL for isolated PostgreSQL coverage', timeout: 30_000 }, operation)
}

async function harness(context) {
  const schema = `glossary_test_${randomUUID().replaceAll('-', '')}`
  const options = { prepare: false, connect_timeout: 5, onnotice: () => {} }
  const control = postgres(databaseUrl, { ...options, max: 1 })
  let sql
  let created = false
  context.after(async () => {
    try {
      if (sql) await sql.end({ timeout: 5 })
      if (created) await control`DROP SCHEMA ${control(schema)} CASCADE`
    } finally { await control.end({ timeout: 5 }) }
  })
  await control`CREATE SCHEMA ${control(schema)}`
  created = true
  sql = postgres(databaseUrl, { ...options, max: 5, connection: { search_path: schema, lock_timeout: '5000', statement_timeout: '10000' } })
  for (const name of ['0001_initial.sql', '0010_translation_change_kind.sql', '0019_editor_glossary.sql', '0021_team_dictionary_ownership.sql']) await sql.unsafe(readFileSync(path.join(root, 'database/migrations', name), 'utf8'))
  await sql`INSERT INTO app_users (google_sub, email, handle, role) VALUES ('author', 'author@test.invalid', 'Author', 'user'), ('reviewer', 'reviewer@test.invalid', 'Reviewer', 'verified'), ('outsider', 'outsider@test.invalid', 'Other', 'user')`
  const loaded = modules(sql)
  const dictionaries = loaded.load('server/utils/editor-dictionary.ts')
  const entries = loaded.load('server/utils/editor-dictionary/entries.ts')
  const glossary = loaded.validation
  const dictionary = await dictionaries.createEditorDictionary(reviewer, { name: '공통 기준', visibility: 'public', isTeam: true })
  return { sql, dictionary, dictionaries, entries, glossary }
}

integration('glossary DB: preserve private dictionaries and reject direct team edits or unauthorized review', async (context) => {
  const h = await harness(context)
  const privateDictionary = await h.dictionaries.createEditorDictionary(author, { name: '개인 기준' })
  assert.equal(privateDictionary.isTeam, false)
  const old = await h.entries.createEditorDictionaryEntry(author, privateDictionary.id, { sourceText: '旧', translation: '기존', note: '보존' })
  assert.equal(old.translation, '기존')
  await assert.rejects(h.entries.getEditorDictionaryEntries(outsider, privateDictionary.id, {}), error => error.statusCode === 404)
  await assert.rejects(h.dictionaries.createEditorDictionary(author, { name: '공통', visibility: 'public', isTeam: true }), error => error.statusCode === 403)
  await assert.rejects(h.entries.createEditorDictionaryEntry(reviewer, h.dictionary.id, { sourceText: '新', translation: '신규' }), error => error.statusCode === 403)
  const p = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput())
  await assert.rejects(h.glossary.decideGlossaryProposal(author, h.dictionary.id, p.id, { action: 'approve' }), error => error.statusCode === 403)
})

integration('glossary DB: approval, multilingual search and idempotent retry leave translations untouched', async (context) => {
  const h = await harness(context)
  const requestId = randomUUID()
  const input = proposalInput({ requestId, metadata: metadata({ japanese: 'スターコイン', historical: ['스타코인'] }) })
  const [p, retry] = await Promise.all([h.glossary.proposeGlossaryEntry(author, h.dictionary.id, input), h.glossary.proposeGlossaryEntry(author, h.dictionary.id, input)])
  assert.equal(p.id, retry.id)
  assert.equal((await h.entries.getEditorDictionaryEntries(outsider, h.dictionary.id, {})).total, 0)
  const approved = await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, p.id, { action: 'approve' })
  assert.equal(approved.status, 'approved')
  for (const search of ['星币', 'スターコイン', '스타 코인', '스타코인']) assert.equal((await h.entries.getEditorDictionaryEntries(outsider, h.dictionary.id, { search })).total, 1)
  assert.equal((await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, input)).id, p.id)
  await assert.rejects(h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, p.id, { action: 'approve' }), error => error.statusCode === 409)
  const [counts] = await h.sql`SELECT (SELECT count(*) FROM translations)::int AS translations, (SELECT count(*) FROM translation_changes)::int AS changes`
  assert.deepEqual(counts, { translations: 0, changes: 0 })
})

integration('glossary DB: hold, resume, rejection and withdrawal keep the current rule and audit trail', async (context) => {
  const h = await harness(context)
  let p = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput())
  p = await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, p.id, { action: 'approve' })
  const change = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ entryId: p.resultEntryId, baseRevision: 1, translation: '다른 표기', changeKind: 'style' }))
  await assert.rejects(h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, change.id, { action: 'hold', reason: '' }), error => error.statusCode === 400)
  await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, change.id, { action: 'hold', reason: '기존 표기 정착 · 다음 관련 작업 때 검토' })
  await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, change.id, { action: 'resume' })
  const result = await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, change.id, { action: 'reject', reason: '현재 기준 유지' })
  assert.equal(result.history.length, 3)
  assert.equal((await h.entries.getEditorDictionaryEntry(author, h.dictionary.id, p.resultEntryId)).translation, '스타 코인')
  const withdrawn = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput())
  await assert.rejects(h.glossary.decideGlossaryProposal(outsider, h.dictionary.id, withdrawn.id, { action: 'withdraw' }), error => error.statusCode === 403)
  assert.equal((await h.glossary.decideGlossaryProposal(author, h.dictionary.id, withdrawn.id, { action: 'withdraw' })).status, 'withdrawn')
})

integration('glossary DB: concurrent approvals of competing revisions allow exactly one winner', async (context) => {
  const h = await harness(context)
  const initial = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput())
  const approved = await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, initial.id, { action: 'approve' })
  const entryId = approved.resultEntryId
  const proposals = await Promise.all(['기준 A', '기준 B'].map(translation => h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ translation, entryId, baseRevision: 1, changeKind: 'terminology' }))))
  const results = await Promise.allSettled(proposals.map(p => h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, p.id, { action: 'approve' })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.statusCode, 409)
  assert.equal((await h.entries.getEditorDictionaryEntry(author, h.dictionary.id, entryId)).revision, 2)
})

integration('glossary DB: unresolved meanings cannot be approved and voice cards need representative dialogue', async (context) => {
  const h = await harness(context)
  const p = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ metadata: metadata({ semanticReview: 'unresolved', semanticNote: '두 언어 의미 차이 확인 필요' }) }))
  await assert.rejects(h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, p.id, { action: 'approve' }), error => error.statusCode === 409)
  await assert.rejects(h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ metadata: metadata({ kind: 'voice' }) })), error => error.statusCode === 400)
  const voice = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ translation: '시연 캐릭터', metadata: metadata({ kind: 'voice', speechStyle: '친근한 존댓말', exampleTranslation: '반가워요.' }) }))
  await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, voice.id, { action: 'approve' })
  assert.equal((await h.entries.getEditorDictionaryEntries(author, h.dictionary.id, { kind: 'voice' })).total, 1)
  assert.equal((await h.entries.getEditorDictionaryEntries(author, h.dictionary.id, { kind: 'term' })).total, 0)
})

integration('glossary DB: array metadata is rejected at submission and cannot bypass approval of old proposals', async (context) => {
  const h = await harness(context)
  for (const invalid of [{ scope: ['project'] }, { semanticReview: ['unresolved'] }]) {
    await assert.rejects(h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ metadata: metadata(invalid) })), error => error.statusCode === 400)
    const proposal = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput())
    await h.sql`UPDATE editor_dictionary_proposals SET metadata = ${h.sql.json(metadata(invalid))} WHERE id = ${proposal.id}`
    await assert.rejects(h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, proposal.id, { action: 'approve' }), error => error.statusCode === 400)
    assert.equal((await h.sql`SELECT status FROM editor_dictionary_proposals WHERE id = ${proposal.id}`)[0].status, 'pending')
  }
  assert.equal((await h.entries.getEditorDictionaryEntries(author, h.dictionary.id, {})).total, 0)
})

integration('glossary DB: scoped targets must exist and context cannot leak file or entry rules to other targets', async (context) => {
  const h = await harness(context)
  const itemId = await insertEvidenceFixture(h.sql, evidenceTerm())
  const siblingId = await insertEvidenceFixture(h.sql, evidenceTerm({ key: 'STRFixture_2' }))
  const otherFileId = await insertEvidenceFixture(h.sql, evidenceTerm({ key: 'STROther_1' }))
  for (const [scope, target] of [['file', 'STRMissing'], ['entry', 'STRFixture_missing']]) {
    await assert.rejects(h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ metadata: metadata({ scope, target }) })), error => error.statusCode === 400)
  }
  const approvedIds = []
  for (const [scope, target] of [['file', 'STRFixture'], ['entry', 'STRFixture_1']]) {
    const proposal = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ metadata: metadata({ scope, target }) }))
    assert.equal(proposal.metadata.scope, scope)
    const approved = await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, proposal.id, { action: 'approve' })
    approvedIds.push(approved.resultEntryId)
  }
  assert.deepEqual(Array.from((await h.glossary.getGlossaryContext(itemId)).entries, entry => entry.id).sort(), [...approvedIds].sort())
  assert.deepEqual(Array.from((await h.glossary.getGlossaryContext(siblingId)).entries, entry => entry.id), [approvedIds[0]])
  assert.equal((await h.glossary.getGlossaryContext(otherFileId)).entries.length, 0)
})

integration('glossary DB: related terms use current source, exclude private dictionaries and stop showing archived rules', async (context) => {
  const h = await harness(context)
  const revisionId = randomUUID()
  const itemId = randomUUID()
  const sourceId = randomUUID()
  await h.sql`INSERT INTO game_revisions (id, route, game_version, revision, source_url, catalog_url, catalog_sha256)
    VALUES (${revisionId}, 'INT_STEAM', 'test', '1', 'https://example.invalid', 'https://example.invalid', ${'0'.repeat(64)})`
  await h.sql`INSERT INTO translation_units (id, kind, namespace, unit_key) VALUES (${itemId}, 'str', 'STRTest', '1')`
  await h.sql`INSERT INTO source_versions (id, unit_id, cn_s, jp, source_fingerprint, first_seen_revision_id)
    VALUES (${sourceId}, ${itemId}, '获得星币', 'コインを獲得', ${'1'.repeat(64)}, ${revisionId})`
  await h.sql`UPDATE translation_units SET current_source_version_id = ${sourceId} WHERE id = ${itemId}`
  const proposed = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput())
  const approved = await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, proposed.id, { action: 'approve' })
  const privateDictionary = await h.dictionaries.createEditorDictionary(author, { name: '비공개' })
  await h.entries.createEditorDictionaryEntry(author, privateDictionary.id, { sourceText: '星币', translation: '비공개 값' })
  const related = await h.glossary.getGlossaryContext(itemId)
  assert.equal(related.entries.length, 1)
  assert.equal(related.entries[0].translation, '스타 코인')
  const archive = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ entryId: approved.resultEntryId, baseRevision: 1, changeKind: 'style', metadata: metadata({ archived: true }) }))
  await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, archive.id, { action: 'approve' })
  assert.equal((await h.glossary.getGlossaryContext(itemId)).entries.length, 0)
  assert.equal((await h.entries.getEditorDictionaryEntries(author, h.dictionary.id, {})).total, 0)
  assert.equal((await h.entries.getEditorDictionaryEntries(author, h.dictionary.id, { archived: 'true' })).total, 1)
  assert.equal((await h.glossary.getGlossaryProposals(author, h.dictionary.id, { entryId: approved.resultEntryId })).total, 2)
})

integration('glossary HTTP handler: public listing forwards kind and archive filters to PostgreSQL', async (context) => {
  const h = await harness(context)
  const term = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ metadata: metadata({ archived: true }) }))
  await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, term.id, { action: 'approve' })
  const voice = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({ translation: '시연 캐릭터', metadata: metadata({ kind: 'voice', speechStyle: '존댓말', exampleTranslation: '반가워요.' }) }))
  await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, voice.id, { action: 'approve' })
  const handler = modules(h.sql).load('server/api/editor/dictionaries/[id]/entries.get.ts').default
  async function list(query) {
    const event = h3.createEvent({ url: '/?' + query, headers: { host: 'localhost' }, method: 'GET' }, {})
    event.context.params = { id: h.dictionary.id }
    return handler(event)
  }
  assert.equal((await list('kind=term')).total, 0)
  const voices = await list('kind=voice')
  assert.equal(voices.total, 1)
  assert.equal(voices.entries[0].metadata.kind, 'voice')
  const archived = await list('kind=term&archived=true')
  assert.equal(archived.total, 1)
  assert.equal(archived.entries[0].metadata.archived, true)
})

function evidenceTerm(overrides = {}) {
  return { key: 'STRFixture_1', sourceVersionId: randomUUID(), translation: '스타 코인', japanese: 'スターコイン',
    chineseSimplified: '星币', chineseTraditional: '星幣', note: '합성 테스트 용어의 승인 근거.', ...overrides }
}

// Explicit synthetic relational fixtures, not a public API snapshot or a synchronization path.
async function insertEvidenceFixture(sql, term) {
  const itemId = randomUUID()
  const revisionId = randomUUID()
  const groupId = randomUUID()
  const changeId = randomUUID()
  const separator = term.key.lastIndexOf('_')
  await sql`INSERT INTO game_revisions (id, route, game_version, revision, source_url, catalog_url, catalog_sha256)
    VALUES (${revisionId}, 'TEST_FIXTURE', 'synthetic', ${revisionId}, 'https://example.invalid/source', 'https://example.invalid/catalog', ${'0'.repeat(64)})`
  await sql`INSERT INTO translation_units (id, kind, namespace, unit_key)
    VALUES (${itemId}, 'str', ${term.key.slice(0, separator)}, ${term.key.slice(separator + 1)})`
  await sql`INSERT INTO source_versions (id, unit_id, cn_s, en, jp, cn_t, source_fingerprint, first_seen_revision_id)
    VALUES (${term.sourceVersionId}, ${itemId}, ${term.chineseSimplified}, 'Synthetic fixture', ${term.japanese}, ${term.chineseTraditional}, ${'1'.repeat(64)}, ${revisionId})`
  await sql`UPDATE translation_units SET current_source_version_id = ${term.sourceVersionId} WHERE id = ${itemId}`
  await sql`INSERT INTO translation_change_groups (id, title, created_by) VALUES (${groupId}, '합성 승인 테스트', 'reviewer')`
  await sql`INSERT INTO translation_changes (id, group_id, unit_id, locale, source_version_id, proposed_text, change_kind, status, created_by, reviewed_by, reviewed_at)
    VALUES (${changeId}, ${groupId}, ${itemId}, 'ko', ${term.sourceVersionId}, ${term.translation}, 'translation_edit', 'approved', 'author', 'reviewer', now())`
  await sql`INSERT INTO translations (id, unit_id, locale, text, approved_source_version_id, applied_change_id, approved_by)
    VALUES (${randomUUID()}, ${itemId}, 'ko', ${term.translation}, ${term.sourceVersionId}, ${changeId}, 'reviewer')`
  return itemId
}

integration('base glossary DB: create evidenced terms once, preserve edits and ignore changed evidence', async (context) => {
  const h = await harness(context)
  const term = evidenceTerm()
  const itemId = await insertEvidenceFixture(h.sql, term)
  const data = { origin: PUBLIC_TRANSLATION_ORIGIN, terms: [term] }
  const seeded = await h.sql.begin(async (sql) => {
    await sql.unsafe(renderBaseGlossarySql(data))
    return (await sql`SELECT current_setting('astral.base_glossary_result')::jsonb AS result`)[0].result
  })
  assert.equal(seeded.added, 1)
  assert.equal(seeded.dictionaryId, h.dictionary.id)
  const [entry] = await h.sql`SELECT id, metadata FROM editor_dictionary_entries WHERE dictionary_id = ${seeded.dictionaryId}`
  assert.equal(entry.metadata.evidenceKey, term.key)
  assert.equal(entry.metadata.semanticReview, 'unrecorded')
  await h.sql`UPDATE editor_dictionary_entries SET translation = '유지할 수정', revision = 2 WHERE id = ${entry.id}`
  await h.sql.begin(async (sql) => {
    await sql.unsafe(renderBaseGlossarySql(data))
    assert.equal((await sql`SELECT current_setting('astral.base_glossary_result')::jsonb AS result`)[0].result.existing, 1)
  })
  assert.equal((await h.sql`SELECT translation FROM editor_dictionary_entries WHERE id = ${entry.id}`)[0].translation, '유지할 수정')
  for (const mismatch of [
    { sourceVersionId: randomUUID() }, { key: 'STRMissing_1' }, { translation: '다른 번역' },
    { japanese: '別の原文' }, { chineseSimplified: '其他原文' }, { chineseTraditional: '其他原文' }
  ]) {
    const candidate = { ...term, ...mismatch }
    await h.sql.begin(async (sql) => {
      await sql.unsafe(renderBaseGlossarySql({ ...data, terms: [candidate] }))
      const result = (await sql`SELECT current_setting('astral.base_glossary_result')::jsonb AS result`)[0].result
      assert.equal(result.added, 0)
      assert.deepEqual(result.skipped, [candidate.key])
    })
  }
  assert.equal((await h.glossary.getGlossaryContext(itemId)).entries.length, 1)
})

const baseData = JSON.parse(readFileSync(path.join(root, 'data/glossary-base.json'), 'utf8'))
const migration20 = readFileSync(path.join(root, 'database/migrations/0020_base_glossary.sql'), 'utf8')

test('base glossary migration: generated deployment SQL matches the reviewed dataset', () => {
  assert.equal(migration20, renderBaseGlossarySql(baseData))
})

test('glossary write routes: rate limits block proposals and review decisions before mutation', async () => {
  for (const [route, limitName] of [
    ['server/api/editor/dictionaries/[id]/proposals.post.ts', 'assertEditorMutationRateLimit'],
    ['server/api/editor/dictionaries/[id]/proposals/[proposalId].patch.ts', 'assertEditorReviewRateLimit']
  ]) {
    let limitedUser = ''
    const overrides = new Map([
      [path.join(root, 'server/utils/auth-user.ts'), { requireCurrentSessionUser: async () => reviewer }],
      [path.join(root, 'server/utils/request-security.ts'), { readJsonBody: async () => ({}) }],
      [path.join(root, 'server/utils/editor-rate-limit.ts'), { [limitName]: async (userId) => {
        limitedUser = userId
        throw h3.createError({ statusCode: 429 })
      } }]
    ])
    const handler = modules(null, {}, overrides).load(route).default
    const event = h3.createEvent({ url: '/', headers: { host: 'localhost' }, method: 'POST' }, {})
    await assert.rejects(handler(event), error => error.statusCode === 429)
    assert.equal(limitedUser, reviewer.id)
  }
})

integration('base glossary migration: empty DB remains empty and repeated application is harmless', async (context) => {
  const h = await harness(context)
  await h.sql.unsafe(migration20)
  await h.sql.unsafe(migration20)
  assert.equal((await h.sql`SELECT count(*)::int AS total FROM editor_dictionary_entries`)[0].total, 0)
  assert.equal((await h.sql`SELECT count(*)::int AS total FROM editor_dictionaries`)[0].total, 1)
  assert.equal((await h.sql`SELECT count(*)::int AS total FROM translations`)[0].total, 0)
})

integration('base glossary migration: synthetic approvals leave translations, comments and pending reviews untouched', async (context) => {
  const h = await harness(context)
  await h.sql.unsafe(readFileSync(path.join(root, 'database/migrations/0007_editor_comments.sql'), 'utf8'))
  const [first, second] = baseData.terms
  const itemId = await insertEvidenceFixture(h.sql, first)
  await insertEvidenceFixture(h.sql, second)
  await h.sql`INSERT INTO editor_comments (id, unit_id, created_by, body) VALUES (${randomUUID()}, ${itemId}, 'author', '보존할 기존 코멘트')`
  const pendingGroup = randomUUID()
  await h.sql`INSERT INTO translation_change_groups (id, title, created_by) VALUES (${pendingGroup}, '대기 중인 합성 검토', 'author')`
  await h.sql`INSERT INTO translation_changes (id, group_id, unit_id, locale, source_version_id, proposed_text, change_kind, created_by)
    VALUES (${randomUUID()}, ${pendingGroup}, ${itemId}, 'ko', ${first.sourceVersionId}, '대기 중인 번역', 'translation_edit', 'author')`
  const pending = await h.glossary.proposeGlossaryEntry(author, h.dictionary.id, proposalInput({
    translation: '진행 중인 검토', metadata: metadata({ japanese: second.japanese, chineseSimplified: second.chineseSimplified, chineseTraditional: second.chineseTraditional })
  }))
  const before = await h.sql`SELECT id, text, applied_change_id, approved_by, updated_at FROM translations ORDER BY id`
  const beforeChanges = await h.sql`SELECT id, status, proposed_text FROM translation_changes ORDER BY id`
  const beforeReview = await h.sql`SELECT * FROM editor_dictionary_proposals WHERE id = ${pending.id}`
  const beforeComments = await h.sql`SELECT * FROM editor_comments ORDER BY id`
  await h.sql.unsafe(migration20)
  const entries = await h.sql`SELECT translation, metadata FROM editor_dictionary_entries`
  assert.equal(entries.length, 1)
  assert.equal(entries[0].translation, first.translation)
  assert.equal(entries[0].metadata.evidenceKey, first.key)
  assert.deepEqual(await h.sql`SELECT id, text, applied_change_id, approved_by, updated_at FROM translations ORDER BY id`, before)
  assert.deepEqual(await h.sql`SELECT id, status, proposed_text FROM translation_changes ORDER BY id`, beforeChanges)
  assert.deepEqual(await h.sql`SELECT * FROM editor_dictionary_proposals WHERE id = ${pending.id}`, beforeReview)
  assert.deepEqual(await h.sql`SELECT * FROM editor_comments ORDER BY id`, beforeComments)
  await h.sql.unsafe(migration20)
  assert.equal((await h.sql`SELECT count(*)::int AS total FROM editor_dictionary_entries`)[0].total, 1)
})

integration('base glossary migration: preserved private dictionaries, archived rules and rules in other team dictionaries', async (context) => {
  const h = await harness(context)
  const term = baseData.terms[0]
  await insertEvidenceFixture(h.sql, term)
  const personal = await h.dictionaries.createEditorDictionary(author, { name: '개인 용어', visibility: 'private' })
  await h.entries.createEditorDictionaryEntry(author, personal.id, { sourceText: term.japanese, translation: '개인 표기', note: '보존' })
  const team = await h.dictionaries.createEditorDictionary(reviewer, { name: '다른 공통 기준', visibility: 'public', isTeam: true })
  const rule = await h.glossary.proposeGlossaryEntry(reviewer, team.id, proposalInput({ translation: '이미 정한 표기',
    metadata: metadata({ archived: true, japanese: term.japanese, chineseSimplified: term.chineseSimplified, chineseTraditional: term.chineseTraditional }) }))
  await h.glossary.decideGlossaryProposal(reviewer, team.id, rule.id, { action: 'approve' })
  const before = await h.sql`SELECT id, dictionary_id, translation, metadata, revision FROM editor_dictionary_entries ORDER BY id`
  await h.sql.unsafe(migration20)
  assert.deepEqual(await h.sql`SELECT id, dictionary_id, translation, metadata, revision FROM editor_dictionary_entries ORDER BY id`, before)
  assert.equal((await h.sql`SELECT visibility FROM editor_dictionaries WHERE id = ${personal.id}`)[0].visibility, 'private')
})

integration('base glossary migration: an unrelated dictionary ID collision rolls back without publishing private data', async (context) => {
  const h = await harness(context)
  await h.sql`UPDATE editor_dictionaries SET id = ${BASE_GLOSSARY_ID}, is_team = false, visibility = 'private' WHERE id = ${h.dictionary.id}`
  const term = baseData.terms[0]
  await insertEvidenceFixture(h.sql, term)
  await assert.rejects(h.sql.unsafe(migration20), /belongs to another dictionary/)
  assert.equal((await h.sql`SELECT visibility FROM editor_dictionaries WHERE id = ${BASE_GLOSSARY_ID}`)[0].visibility, 'private')
  assert.equal((await h.sql`SELECT count(*)::int AS total FROM editor_dictionary_entries`)[0].total, 0)
})
