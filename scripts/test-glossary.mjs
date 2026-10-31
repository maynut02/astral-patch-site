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

function clientHarness(context, fetch, query = {}, extraGlobals = {}) {
  const route = { query }
  const scope = vue.effectScope()
  const unmount = []
  context.after(() => {
    for (const callback of unmount) callback()
    scope.stop()
  })
  const list = { dictionaries: vue.ref([]), dictionariesStatus: vue.ref('success'), dictionariesError: vue.ref(''), loadDictionaries: async () => {} }
  const globals = {
    ref: vue.ref, computed: vue.computed, watch: vue.watch, onMounted: () => {}, onUnmounted: callback => unmount.push(callback),
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    useRoute: () => route,
    useRouter: () => ({ replace: async ({ query }) => { route.query = query } }),
    useUserSession: () => ({ loggedIn: vue.ref(true), user: vue.ref({ role: 'verified' }) }),
    useAppToast: () => ({ showLoginRequiredToast: () => {} }),
    $fetch: fetch,
    ...extraGlobals
  }
  const loader = modules(null, globals, new Map([[path.join(root, 'app/composables/editor-dictionaries.ts'), { useEditorDictionaryList: () => list }]]))
  return { route, create: (file, method, ...args) => scope.run(() => loader.load(file)[method](...args)) }
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
  for (const name of ['0001_initial.sql', '0019_editor_glossary.sql']) await sql.unsafe(readFileSync(path.join(root, 'database/migrations', name), 'utf8'))
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

const harvestPure = pure.load('server/utils/editor-dictionary/harvest.ts')
const harvestSource = () => ({ itemId: randomUUID(), sourceVersionId: randomUUID(), category: 'STRTest', unitKey: '1', jp: 'スターコインを獲得。<tag value="秘密">{隠し}', cnS: '获得星币', cnT: '', ko: '스타 코인을 얻습니다.', fingerprint: 'a'.repeat(64) })
const harvestInput = source => ({ itemId: source.itemId, translation: '스타 코인', japanese: 'スターコイン', chineseSimplified: '星币', chineseTraditional: '', note: '게임 재화. 중국어 의미 대조 필요.' })

test('glossary harvest: extraction rejects invented terms, wrong evidence and tag-only matches', () => {
  const source = harvestSource()
  const valid = harvestInput(source)
  const output = harvestPure.parseHarvestOutput(JSON.stringify({ candidates: [valid, valid, { ...valid, translation: '허구 용어' }, { ...valid, itemId: randomUUID() }, { ...valid, japanese: '秘密' }, { ...valid, japanese: '隠し' }] }), [source])
  assert.equal(output.candidates.length, 1)
  assert.equal(output.excluded, 5)
  assert.equal(output.candidates[0].scope, 'file')
  assert.equal(output.candidates[0].source.itemId, source.itemId)
  assert.equal(harvestPure.parseHarvestCandidate({ ...valid, scope: 'project', semanticReview: 'recorded' }, [source], true).scope, 'file')
  assert.throws(() => harvestPure.parseHarvestOutput('{"candidates":{}}', [source]), error => error.statusCode === 400)
  assert.throws(() => harvestPure.parseHarvestOutput(JSON.stringify({ candidates: Array(21).fill(valid) }), [source]), error => error.statusCode === 400)
})

test('glossary harvest: conflicting Korean spellings stay available for comparison', () => {
  const source = { ...harvestSource(), ko: '스타 코인과 스타코인' }
  const result = harvestPure.parseHarvestOutput(JSON.stringify({ candidates: [harvestInput(source), { ...harvestInput(source), translation: '스타코인' }] }), [source])
  assert.equal(result.candidates.length, 2)
  const corrected = harvestPure.parseHarvestCandidate({ ...result.candidates[0], translation: '수정한 표기', scope: 'project' }, [source])
  assert.equal(corrected.translation, '수정한 표기')
  assert.equal(corrected.scope, 'project')
})

test('glossary harvest: all domain operations reject ordinary users before querying or calling AI', async () => {
  for (const name of ['getHarvestSources', 'exportHarvestSources', 'extractHarvest', 'previewHarvest', 'submitHarvest']) {
    await assert.rejects(harvestPure[name](author, randomUUID(), {}), error => error.statusCode === 403)
  }
})

async function seedHarvest(h, count = 1) {
  const revisionId = randomUUID()
  const groupId = randomUUID()
  await h.sql`INSERT INTO game_revisions (id, route, game_version, revision, source_url, catalog_url, catalog_sha256)
    VALUES (${revisionId}, 'INT_STEAM', 'test', '1', 'https://example.invalid', 'https://example.invalid', ${'0'.repeat(64)})`
  await h.sql`INSERT INTO translation_change_groups (id, title, created_by) VALUES (${groupId}, 'harvest fixture', 'reviewer')`
  const ids = []
  for (let index = 0; index < count; index++) {
    const itemId = randomUUID()
    const sourceId = randomUUID()
    const changeId = randomUUID()
    const ko = '스타 코인을 얻습니다.'
    await h.sql`INSERT INTO translation_units (id, kind, namespace, unit_key) VALUES (${itemId}, 'str', 'STRTest', ${String(index).padStart(3, '0')})`
    await h.sql`INSERT INTO source_versions (id, unit_id, cn_s, jp, source_fingerprint, first_seen_revision_id)
      VALUES (${sourceId}, ${itemId}, '获得星币', 'スターコインを獲得', ${String(index).padStart(64, '0')}, ${revisionId})`
    await h.sql`UPDATE translation_units SET current_source_version_id = ${sourceId} WHERE id = ${itemId}`
    await h.sql`INSERT INTO translation_changes (id, group_id, unit_id, locale, source_version_id, proposed_text, status, created_by, reviewed_by, reviewed_at)
      VALUES (${changeId}, ${groupId}, ${itemId}, 'ko', ${sourceId}, ${ko}, 'approved', 'reviewer', 'reviewer', now())`
    await h.sql`INSERT INTO translations (id, unit_id, locale, text, approved_source_version_id, applied_change_id, approved_by)
      VALUES (${randomUUID()}, ${itemId}, 'ko', ${ko}, ${sourceId}, ${changeId}, 'reviewer')`
    ids.push(itemId)
  }
  return ids
}

function harvestModule(sql, config = {}, fetch = async () => {
  throw new Error('Unexpected AI call')
}) {
  return modules(sql, { process: { env: {} }, useRuntimeConfig: () => config, $fetch: fetch }).load('server/utils/editor-dictionary/harvest.ts')
}

integration('glossary harvest DB: stable pages collect only current approved translations and detect changed evidence', async (context) => {
  const h = await harness(context)
  const ids = await seedHarvest(h, 22)
  const harvest = harvestModule(h.sql)
  const first = await harvest.getHarvestSources(reviewer, h.dictionary.id, {})
  const second = await harvest.getHarvestSources(reviewer, h.dictionary.id, { page: '2' })
  assert.equal(first.sources.length, 20)
  assert.equal(second.sources.length, 2)
  assert.equal(first.total, 22)
  assert.equal(first.aiConfigured, false)
  assert.equal(first.sources.some(source => second.sources.some(row => row.itemId === source.itemId)), false)
  const exported = await harvest.exportHarvestSources(reviewer, h.dictionary.id, { category: 'STRTest' })
  assert.equal(exported.sources.length, 22)
  assert.equal(exported.sources[20].fingerprint, second.sources[0].fingerprint)
  assert.match(exported.instructions, /fingerprint/)
  const source = first.sources[0]
  await assert.rejects(harvest.resolveHarvestSources([{ ...source, fingerprint: '0'.repeat(64) }]), error => error.statusCode === 409)
  await h.sql`DELETE FROM translations WHERE unit_id = ${ids[0]}`
  await assert.rejects(harvest.resolveHarvestSources([source]), error => error.statusCode === 409)
  assert.equal((await harvest.getHarvestSources(reviewer, h.dictionary.id, {})).total, 21)
  await assert.rejects(harvest.extractHarvest(reviewer, h.dictionary.id, { sources: second.sources }), error => error.statusCode === 503)
})

integration('glossary harvest DB: AI gateway output becomes unapproved candidates and errors do not write entries', async (context) => {
  const h = await harness(context)
  await seedHarvest(h)
  let calls = 0
  let source
  const harvest = harvestModule(h.sql, { aiApiKey: 'test-key', aiBaseUrl: 'https://ai.invalid/v1' }, async (url, options) => {
    calls++
    assert.equal(url, 'https://ai.invalid/v1/chat/completions/')
    assert.equal(options.retry, 0)
    assert.match(options.body.messages[1].content, /확정 한국어 번역/)
    return { choices: [{ message: { content: JSON.stringify({ candidates: [harvestInput(source)] }) } }] }
  })
  source = (await harvest.getHarvestSources(reviewer, h.dictionary.id, {})).sources[0]
  const result = await harvest.extractHarvest(reviewer, h.dictionary.id, { sources: [source] })
  assert.equal(result.candidates.length, 1)
  assert.equal(calls, 1)
  const broken = harvestModule(h.sql, { aiApiKey: 'test-key' }, async () => ({ choices: [{ message: { content: 'invalid json' } }] }))
  await assert.rejects(broken.extractHarvest(reviewer, h.dictionary.id, { sources: [source] }), error => error.statusCode === 502)
  const [counts] = await h.sql`SELECT (SELECT count(*) FROM editor_dictionary_entries)::int AS entries, (SELECT count(*) FROM editor_dictionary_proposals)::int AS proposals`
  assert.deepEqual(counts, { entries: 0, proposals: 0 })
})

integration('glossary harvest DB: bulk registration retries are idempotent, duplicates are skipped and translations stay intact', async (context) => {
  const h = await harness(context)
  await seedHarvest(h)
  const harvest = harvestModule(h.sql)
  const source = (await harvest.getHarvestSources(reviewer, h.dictionary.id, {})).sources[0]
  const candidate = harvestPure.parseHarvestOutput(JSON.stringify({ candidates: [harvestInput(source)] }), [source]).candidates[0]
  const before = await h.sql`SELECT text, applied_change_id FROM translations`
  const [first, retry] = await Promise.all([harvest.submitHarvest(reviewer, h.dictionary.id, { candidates: [candidate] }), harvest.submitHarvest(reviewer, h.dictionary.id, { candidates: [candidate] })])
  assert.equal(first.results[0].status, 'submitted')
  assert.equal(first.results[0].proposalId, retry.results[0].proposalId)
  const more = await harvest.submitHarvest(reviewer, h.dictionary.id, { candidates: [{ ...candidate, requestId: randomUUID() }, { ...candidate, requestId: randomUUID(), japanese: '없는 원문' }] })
  assert.equal(more.results[0].status, 'duplicate')
  assert.equal(more.results[1].status, 'error')
  assert.equal((await h.glossary.getGlossaryProposals(reviewer, h.dictionary.id, { status: 'pending' })).total, 1)
  assert.equal((await h.entries.getEditorDictionaryEntries(reviewer, h.dictionary.id, {})).total, 0)
  assert.deepEqual(await h.sql`SELECT text, applied_change_id FROM translations`, before)
  await h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, first.results[0].proposalId, { action: 'approve' })
  assert.equal((await h.glossary.getGlossaryContext(source.itemId)).entries.length, 1)
  const unresolved = await harvest.submitHarvest(reviewer, h.dictionary.id, { candidates: [{ ...candidate, requestId: randomUUID(), japanese: '獲得', chineseSimplified: '获得', semanticReview: 'unresolved', semanticNote: '게임 내 의미 확인 필요' }] })
  assert.equal(unresolved.results[0].status, 'submitted')
  await assert.rejects(h.glossary.decideGlossaryProposal(reviewer, h.dictionary.id, unresolved.results[0].proposalId, { action: 'approve' }), error => error.statusCode === 409)
})

integration('glossary harvest DB: importing a reviewed backup preserves request identity and corrected spelling', async (context) => {
  const h = await harness(context)
  await seedHarvest(h)
  const harvest = harvestModule(h.sql)
  const source = (await harvest.getHarvestSources(reviewer, h.dictionary.id, {})).sources[0]
  const candidate = { ...harvestPure.parseHarvestOutput(JSON.stringify({ candidates: [harvestInput(source)] }), [source]).candidates[0], translation: '검토한 새 표기', scope: 'project' }
  const result = await harvest.previewHarvest(reviewer, h.dictionary.id, { sources: [source], json: JSON.stringify({ format: 'astral-glossary-candidates-v1', candidates: [candidate] }) })
  assert.equal(result.candidates[0].requestId, candidate.requestId)
  assert.equal(result.candidates[0].translation, candidate.translation)
  assert.equal(result.candidates[0].scope, 'project')
  const stale = { ...candidate, source: { ...source, fingerprint: '0'.repeat(64) } }
  const submitted = await harvest.submitHarvest(reviewer, h.dictionary.id, { candidates: [stale] })
  assert.equal(submitted.results[0].status, 'error')
  assert.match(submitted.results[0].message, /바뀌었습니다/)
})

test('glossary harvest client: drafts restore and partial submission retains failures for retry', async (context) => {
  const source = harvestSource()
  const candidate = { ...harvestPure.parseHarvestOutput(JSON.stringify({ candidates: [harvestInput(source)] }), [source]).candidates[0], selected: true }
  const other = { ...candidate, requestId: randomUUID(), translation: '다른 표기' }
  const store = new Map([['astral-glossary-harvest-v1:reviewer:team', JSON.stringify({ page: 2, category: 'STRTest', activeId: candidate.requestId, drafts: [candidate, other] })]])
  const bodies = []
  const harness = clientHarness(context, async (url, options) => {
    if (url === '/api/editor/dictionaries') return { dictionaries: [{ id: 'team', isTeam: true }] }
    if (url.endsWith('/harvest')) return { sources: [source], categories: [], page: 2, total: 21, totalPages: 2 }
    if (url.endsWith('/submit')) {
      bodies.push(options.body)
      return { results: [{ requestId: candidate.requestId, status: 'submitted', message: '검토 대기' }, { requestId: other.requestId, status: 'error', message: '실패' }] }
    }
    throw new Error('Unexpected request')
  }, { dictionary: 'team' }, {
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    useUserSession: () => ({ loggedIn: vue.ref(true), user: vue.ref({ id: 'reviewer', role: 'verified' }) })
  })
  const state = harness.create('app/composables/glossary-harvest.ts', 'useGlossaryHarvest')
  await state.init()
  assert.equal(state.page.value, 2)
  assert.equal(state.drafts.value.length, 2)
  await state.submit()
  assert.equal(state.drafts.value[0].selected, false)
  assert.equal(state.drafts.value[1].selected, true)
  assert.equal(state.selected.value.length, 1)
  await state.submit()
  assert.equal(bodies[1].candidates.length, 1)
  assert.equal(bodies[1].candidates[0].requestId, other.requestId)
  await flushClient()
  const saved = JSON.parse(store.get('astral-glossary-harvest-v1:reviewer:team'))
  assert.equal(saved.drafts[0].result.status, 'submitted')
})

test('glossary harvest client: malformed JSON preserves the import dialog and input', async (context) => {
  const h = clientHarness(context, async () => {
    throw new Error('Unexpected request')
  }, { dictionary: 'team' })
  const state = h.create('app/composables/glossary-harvest.ts', 'useGlossaryHarvest')
  state.importOpen.value = true
  state.importJson.value = '{invalid json'
  await state.previewImport()
  assert.equal(state.importOpen.value, true)
  assert.equal(state.importJson.value, '{invalid json')
  assert.equal(state.error.value, 'JSON 형식이 올바르지 않습니다.')
})

test('glossary harvest client: switching between a file and all files resets the page but preserves candidates', async (context) => {
  const calls = []
  const source = harvestSource()
  const h = clientHarness(context, async (_url, options) => {
    calls.push(options.query)
    return { sources: [source], categories: [{ category: 'STRTest', total: 1 }], total: 1, page: 1, totalPages: 1 }
  }, { dictionary: 'team' })
  const state = h.create('app/composables/glossary-harvest.ts', 'useGlossaryHarvest')
  state.drafts.value = [{ ...harvestPure.parseHarvestOutput(JSON.stringify({ candidates: [harvestInput(source)] }), [source]).candidates[0], selected: true }]
  state.page.value = 3
  await state.changeCategory('STRTest')
  assert.equal(state.page.value, 1)
  assert.equal(calls[0].category, 'STRTest')
  await state.changeCategory('')
  assert.equal(calls[1].category, undefined)
  assert.equal(state.drafts.value.length, 1)
  assert.equal(state.selected.value.length, 1)
})
