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
import { fetchPublicSnapshot, importPublicSnapshot, validatePublicSnapshot, PUBLIC_TRANSLATION_ORIGIN } from './sync-public-translations.mjs'
import { seedBaseGlossary, BASE_GLOSSARY_ID } from './seed-base-glossary.mjs'

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

function clientHarness(context, fetch, query = {}) {
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
    $fetch: fetch
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

function publicItem(overrides = {}) {
  return { id: randomUUID(), sourceVersionId: randomUUID(), kind: 'str', category: 'STRItem', unitKey: '1',
    jp: 'スターコイン', cnS: '星币', cnT: '星幣', en: 'Star Coin', ko: '스타 코인',
    pendingKo: null, approvedForCurrentSource: true, ...overrides }
}
const publicSnapshot = items => ({ origin: PUBLIC_TRANSLATION_ORIGIN, total: items.length, fetchedAt: '2026-10-31T00:00:00.000Z', items })
async function mirrorHarness(context) {
  const h = await harness(context)
  await h.sql.unsafe(readFileSync(path.join(root, 'database/migrations/0010_translation_change_kind.sql'), 'utf8'))
  return h
}

test('public translation sync: reject incomplete or duplicate snapshots before writing', () => {
  const item = publicItem()
  assert.throws(() => validatePublicSnapshot({ ...publicSnapshot([item]), total: 2 }))
  assert.throws(() => validatePublicSnapshot(publicSnapshot([item, item])))
  assert.throws(() => validatePublicSnapshot(publicSnapshot([{ ...item, ko: null }])))
})

test('public translation sync: collect every page and detect pagination drift', async () => {
  const rows = [publicItem({ unitKey: '1' }), publicItem({ unitKey: '2' }), publicItem({ unitKey: '3' })]
  const fetched = []
  const result = await fetchPublicSnapshot(async (url) => {
    const page = Number(new URL(url).searchParams.get('page'))
    fetched.push(page)
    return { ok: true, json: async () => ({ total: 3, totalPages: 3, items: [rows[page - 1]] }) }
  })
  assert.equal(result.items.length, 3)
  assert.deepEqual(fetched.sort(), [1, 2, 3])
  await assert.rejects(fetchPublicSnapshot(async url => ({
    ok: true, json: async () => ({ total: url.endsWith('1') ? 3 : 4, totalPages: 3, items: [rows[0]] })
  })), /조회 중/)
})

integration('public translation DB: mirror real IDs and languages without approving pending or stale text', async (context) => {
  const h = await mirrorHarness(context)
  const approved = publicItem()
  const pending = publicItem({ unitKey: '2', pendingKo: '대기 중', ko: '대기 중' })
  const stale = publicItem({ unitKey: '3', ko: '확인 전 번역', approvedForCurrentSource: false })
  const untranslated = publicItem({ unitKey: '4', ko: '', approvedForCurrentSource: null })
  const input = publicSnapshot([approved, pending, stale, untranslated])
  const result = await importPublicSnapshot(h.sql, input)
  assert.equal(result.total, 4)
  assert.equal(result.approved, 1)
  const rows = await h.sql`SELECT unit_id, source_version_id, jp, cn_s, en, cn_t, approved_text FROM translation_workbench ORDER BY unit_key`
  assert.equal(rows[0].unit_id, approved.id)
  assert.equal(rows[0].source_version_id, approved.sourceVersionId)
  assert.equal(rows[0].approved_text, approved.ko)
  assert.equal(rows[0].jp, approved.jp)
  assert.equal(rows[0].cn_s, approved.cnS)
  assert.equal(rows[0].cn_t, approved.cnT)
  assert.equal(rows[0].en, approved.en)
  assert.equal(rows.filter(row => row.approved_text === null).length, 3)
  await importPublicSnapshot(h.sql, input)
  assert.equal((await h.sql`SELECT count(*)::int AS total FROM translation_changes`)[0].total, 1)
})

integration('public translation DB: a new remote approval updates its mirror and preserves local approvals', async (context) => {
  const h = await mirrorHarness(context)
  const item = publicItem()
  await importPublicSnapshot(h.sql, publicSnapshot([item]))
  await importPublicSnapshot(h.sql, publicSnapshot([{ ...item, ko: '변경된 공개 번역' }]))
  assert.equal((await h.sql`SELECT text FROM translations WHERE unit_id = ${item.id}`)[0].text, '변경된 공개 번역')
  const group = randomUUID()
  const change = randomUUID()
  await h.sql`INSERT INTO translation_change_groups (id, title, created_by) VALUES (${group}, '로컬 검토', 'reviewer')`
  await h.sql`INSERT INTO translation_changes (id, group_id, unit_id, locale, source_version_id, proposed_text, change_kind, status, created_by, reviewed_by, reviewed_at)
    VALUES (${change}, ${group}, ${item.id}, 'ko', ${item.sourceVersionId}, '로컬 확정 표기', 'translation_edit', 'approved', 'reviewer', 'reviewer', now())`
  await h.sql`UPDATE translations SET text = '로컬 확정 표기', applied_change_id = ${change} WHERE unit_id = ${item.id}`
  await importPublicSnapshot(h.sql, publicSnapshot([{ ...item, ko: '새 운영 번역' }]))
  assert.equal((await h.sql`SELECT text FROM translations WHERE unit_id = ${item.id}`)[0].text, '로컬 확정 표기')
})

integration('public translation DB: changed source content under the same version rolls back the import', async (context) => {
  const h = await mirrorHarness(context)
  const item = publicItem()
  await importPublicSnapshot(h.sql, publicSnapshot([item]))
  await assert.rejects(importPublicSnapshot(h.sql, publicSnapshot([{ ...item, jp: '변경된 같은 버전' }])), /같은 원문 버전/)
  assert.equal((await h.sql`SELECT jp FROM current_source_texts WHERE unit_id = ${item.id}`)[0].jp, item.jp)
})

integration('base glossary DB: create evidenced terms once, preserve edits and ignore changed evidence', async (context) => {
  const h = await mirrorHarness(context)
  const item = publicItem()
  await importPublicSnapshot(h.sql, publicSnapshot([item]))
  const term = { key: 'STRItem_1', sourceVersionId: item.sourceVersionId, translation: item.ko, japanese: item.jp, chineseSimplified: item.cnS, chineseTraditional: item.cnT, note: '기존 번역 표기 유지.' }
  const data = { origin: PUBLIC_TRANSLATION_ORIGIN, terms: [term] }
  assert.equal((await seedBaseGlossary(h.sql, data)).added, 1)
  const [entry] = await h.sql`SELECT id, metadata FROM editor_dictionary_entries WHERE dictionary_id = ${BASE_GLOSSARY_ID}`
  assert.equal(entry.metadata.evidenceKey, term.key)
  assert.equal(entry.metadata.semanticReview, 'unrecorded')
  await h.sql`UPDATE editor_dictionary_entries SET translation = '유지할 수정', revision = 2 WHERE id = ${entry.id}`
  assert.equal((await seedBaseGlossary(h.sql, data)).existing, 1)
  assert.equal((await h.sql`SELECT translation FROM editor_dictionary_entries WHERE id = ${entry.id}`)[0].translation, '유지할 수정')
  const stale = await seedBaseGlossary(h.sql, { ...data, terms: [{ ...term, sourceVersionId: randomUUID() }] })
  assert.deepEqual(stale.skipped, ['STRItem_1'])
  const contextResult = await h.glossary.getGlossaryContext(item.id)
  assert.equal(contextResult.entries.length, 1)
})
