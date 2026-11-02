import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import postgres from 'postgres'
import ts from 'typescript'

// TEST_DATABASE_URL only: node scripts/test-user-account.mjs
// Each case owns a disposable schema; no OAuth, external network or SQL mocks.
const databaseUrl = process.env.TEST_DATABASE_URL
const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const nuxtRequire = createRequire(require.resolve('nuxt/package.json'))
const h3 = await import(pathToFileURL(nuxtRequire.resolve('h3')).href)
const migrations = [
  '0001_initial.sql', '0002_user_profile_details.sql', '0003_user_game_profile_constraints.sql',
  '0007_editor_comments.sql', '0008_notices.sql', '0010_translation_change_kind.sql',
  '0013_mod_hub.sql', '0014_mod_numeric_ids.sql', '0017_translation_pack_publications.sql',
  '0018_translation_change_publication.sql', '0019_editor_glossary.sql'
]
const ownershipMigration = readFileSync(path.join(root, 'database/migrations/0021_team_dictionary_ownership.sql'), 'utf8')
const author = { id: 'google-author', role: 'verified' }
const reviewer = { id: 'google-reviewer', role: 'verified' }
const outsider = { id: 'google-outsider', role: 'user' }
const at = '2020-01-01T00:00:00.000Z'

function integrationTest(name, operation) {
  test(name, { skip: databaseUrl ? false : 'Set TEST_DATABASE_URL for isolated PostgreSQL coverage', timeout: 30_000 }, operation)
}

function modules(database, globals = {}) {
  const cache = new Map()
  function load(filename) {
    filename = path.resolve(root, filename)
    if (filename === path.join(root, 'server/utils/database.ts')) return { getDatabase: () => database, withDatabaseRetry: operation => operation(database) }
    if (filename === path.join(root, 'server/utils/ws-hub.ts')) return { broadcastWsMessage: () => {} }
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    runInNewContext(code, {
      module, exports: module.exports, Date, console, defineEventHandler: handler => handler, ...globals,
      require(specifier) {
        if (specifier === 'h3') return h3
        if (specifier.startsWith('node:')) return require(specifier)
        let target = specifier.startsWith('#shared/') ? path.join(root, 'shared', specifier.slice(8)) : path.resolve(path.dirname(filename), specifier)
        if (!existsSync(target) || !statSync(target).isFile()) target += '.ts'
        return load(target)
      }
    }, { filename })
    return module.exports
  }
  return { load }
}

async function harness(context, { beforeOwnershipMigration = false } = {}) {
  const schema = `account_test_${randomUUID().replaceAll('-', '')}`
  const options = { prepare: false, connect_timeout: 5, onnotice: () => {} }
  const control = postgres(databaseUrl, { ...options, max: 1 })
  let database
  let created = false
  context.after(async () => {
    try {
      if (database) await database.end({ timeout: 5 })
      if (created) await control`DROP SCHEMA ${control(schema)} CASCADE`
    } finally { await control.end({ timeout: 5 }) }
  })
  await control`CREATE SCHEMA ${control(schema)}`
  created = true
  const connection = { search_path: schema, statement_timeout: '10000', lock_timeout: '5000' }
  database = postgres(databaseUrl, { ...options, max: 5, connection })
  for (const migration of migrations) {
    await database.begin(transaction => transaction.unsafe(readFileSync(path.join(root, 'database/migrations', migration), 'utf8')))
  }
  if (!beforeOwnershipMigration) await database.begin(transaction => transaction.unsafe(ownershipMigration))
  for (const user of [author, reviewer, outsider]) {
    await database`INSERT INTO app_users (google_sub, email, handle, role, game_uid, game_invite_code)
      VALUES (${user.id}, ${`${user.id}@example.invalid`}, ${user.id.replaceAll('-', '')}, ${user.role}, '123456', 'Invite123')`
  }
  let session = { user: { ...author, email: `${author.id}@example.invalid`, handle: author.id.replaceAll('-', '') } }
  const loader = modules(database, {
    getUserSession: async () => session,
    setUserSession: async (_event, value) => {
      session = value
    }
  })
  return {
    database, load: loader.load,
    connect: () => postgres(databaseUrl, { ...options, max: 1, connection }),
    remove: loader.load('server/utils/user-account.ts').deleteUserAccount,
    dictionaries: loader.load('server/utils/editor-dictionary.ts'),
    glossary: loader.load('server/utils/editor-dictionary/glossary.ts'),
    auth: loader.load('server/utils/auth-user.ts')
  }
}

async function waitForBlock(database, waitingPid, blockingPid) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const [row] = await database`SELECT ${blockingPid}::int = ANY(pg_blocking_pids(${waitingPid}::int)) AS blocked`
    if (row.blocked) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(`Database connection ${waitingPid} did not block on ${blockingPid}`)
}

const contentTables = [
  'source_changes', 'translation_change_groups', 'translation_changes', 'translations',
  'editor_dictionaries', 'editor_dictionary_entries', 'editor_dictionary_proposals',
  'editor_comments', 'notices', 'mods', 'translation_pack_publications'
]
async function snapshot(database) {
  const result = {}
  for (const table of contentTables) {
    const rows = await database`SELECT to_jsonb(content) AS value FROM ${database(table)} AS content`
    result[table] = rows.map(row => row.value).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  return result
}

async function seed(h) {
  const sql = h.database
  const game = randomUUID(), unit = randomUUID(), source = randomUUID(), group = randomUUID(), change = randomUUID()
  await sql`INSERT INTO app_user_social_links (id, user_id, label, url) VALUES (${randomUUID()}, ${author.id}, 'Personal', 'https://example.invalid/personal')`
  await sql`INSERT INTO game_revisions (id, route, game_version, revision, source_url, catalog_url, catalog_sha256)
    VALUES (${game}, 'INT_STEAM', '1.0.0', '100', 'https://example.invalid/source', 'https://example.invalid/catalog', ${'0'.repeat(64)})`
  await sql`INSERT INTO translation_units (id, kind, namespace, unit_key) VALUES (${unit}, 'lang', 'fixture', 'account')`
  await sql`INSERT INTO source_versions (id, unit_id, en, source_fingerprint, first_seen_revision_id)
    VALUES (${source}, ${unit}, 'Original content', ${'1'.repeat(64)}, ${game})`
  await sql`UPDATE translation_units SET current_source_version_id = ${source} WHERE id = ${unit}`
  await sql`INSERT INTO source_changes (revision_id, unit_id, change_type, new_source_version_id, created_by)
    VALUES (${game}, ${unit}, 'added', ${source}, ${author.id})`
  await sql`INSERT INTO translation_change_groups (id, title, created_by) VALUES (${group}, 'Preserved group', ${author.id})`
  await sql`INSERT INTO translation_changes (id, group_id, unit_id, locale, source_version_id, proposed_text, status, change_kind, created_by, reviewed_by, reviewed_at)
    VALUES (${change}, ${group}, ${unit}, 'ko', ${source}, '보존 번역', 'approved', 'translation_edit', ${author.id}, ${author.id}, ${at})`
  await sql`INSERT INTO translations (id, unit_id, locale, text, approved_source_version_id, applied_change_id, approved_by)
    VALUES (${randomUUID()}, ${unit}, 'ko', '보존 번역', ${source}, ${change}, ${author.id})`
  await sql`INSERT INTO translation_pack_publications (number, game_version, revision, object_key, byte_size, gzip_byte_size, gzip_sha256, lang_count, str_count, published_by)
    VALUES (1, '1.0.0', '100', 'translation-pack/packs/1.json.gz', 1, 1, ${'2'.repeat(64)}, 1, 0, ${author.id})`
  await sql`UPDATE translation_changes SET pack_number = 1 WHERE id = ${change}`
  await sql`INSERT INTO editor_comments (id, unit_id, created_by, body) VALUES (${randomUUID()}, ${unit}, ${author.id}, '보존 댓글')`
  await sql`INSERT INTO notices (id, title, body, created_by) VALUES (${randomUUID()}, '보존 공지', '공지 본문', ${author.id})`
  await sql`INSERT INTO mods (name, repository, platforms, created_by) VALUES ('보존 모드', 'fixture/mod', ARRAY['windows'], ${author.id})`
  const privateDictionary = await h.dictionaries.createEditorDictionary(author, { name: 'Private content', visibility: 'private' })
  const publicDictionary = await h.dictionaries.createEditorDictionary(author, { name: 'Public content', visibility: 'public' })
  const team = await h.dictionaries.createEditorDictionary(author, { name: 'Team content', visibility: 'public', isTeam: true })
  for (const dictionary of [privateDictionary, publicDictionary, team]) {
    await sql`INSERT INTO editor_dictionary_entries (id, dictionary_id, source_text, translation, note, created_by)
      VALUES (${randomUUID()}, ${dictionary.id}, '星币', '스타 코인', '보존 메모', ${author.id})`
  }
  const history = [
    { action: 'hold', reason: '검토', actor: author.id, at, extra: { preserved: true } },
    { action: 'resume', reason: '', actor: reviewer.id, at },
    { action: 'hold', reason: '다시 검토', actor: author.id, at }
  ]
  const metadata = { ...h.load('shared/utils/glossary.ts').emptyGlossaryMetadata(), chineseSimplified: '星币' }
  const proposals = []
  for (const creator of [author.id, reviewer.id]) {
    const id = randomUUID()
    proposals.push(id)
    await sql`INSERT INTO editor_dictionary_proposals (id, dictionary_id, source_text, translation, metadata, change_kind, status, created_by, request_id, history)
      VALUES (${id}, ${team.id}, '星币', '스타 코인', ${sql.json(metadata)}, 'new', 'held', ${creator}, ${randomUUID()}, ${sql.json(history)})`
  }
  return { game, unit, change, privateDictionary, publicDictionary, team, proposals, history }
}

integrationTest('account: all authored content and histories survive, identities are removed, private access never transfers back', async (context) => {
  const h = await harness(context)
  const fixture = await seed(h)
  const before = await snapshot(h.database)
  assert.equal((await h.auth.getCurrentSessionUser({})).id, author.id)
  await h.remove(author.id)
  assert.equal(await h.auth.getCurrentSessionUser({}), null)
  await assert.rejects(h.auth.requireCurrentSessionUser({}), error => error.statusCode === 401)
  assert.equal((await h.database`SELECT * FROM app_users WHERE google_sub = ${author.id}`).length, 0)
  assert.equal((await h.database`SELECT * FROM app_user_social_links WHERE user_id = ${author.id}`).length, 0)
  const [tombstone] = await h.database`SELECT * FROM app_users WHERE google_sub LIKE 'deleted:%'`
  assert.match(tombstone.google_sub, /^deleted:[0-9a-f-]{36}$/)
  assert.equal(tombstone.email, `${tombstone.google_sub}@system.local`)
  assert.equal(tombstone.handle, null)
  assert.equal(tombstone.role, 'user')
  assert.equal(tombstone.game_uid, null)
  assert.equal(tombstone.game_invite_code, null)
  const expected = JSON.parse(JSON.stringify(before), (key, value) =>
    ['created_by', 'reviewed_by', 'approved_by', 'published_by', 'owner_id', 'actor'].includes(key) && value === author.id ? tombstone.google_sub : value)
  assert.deepEqual(await snapshot(h.database), expected)
  for (const viewer of [outsider, reviewer, { id: '', role: 'user' }]) {
    await assert.rejects(h.dictionaries.requireDictionary(h.database, fixture.privateDictionary.id, viewer), error => error.statusCode === 404)
    const listed = await h.dictionaries.getEditorDictionaries(viewer)
    assert.equal(listed.dictionaries.some(dictionary => dictionary.id === fixture.privateDictionary.id), false)
  }
  const renewed = await h.auth.upsertGoogleUser({ sub: author.id, email: `${author.id}@example.invalid`, email_verified: true })
  assert.equal(renewed.googleSub, author.id)
  assert.equal(renewed.handle, null)
  assert.equal(renewed.role, 'user')
  await assert.rejects(h.dictionaries.requireDictionary(h.database, fixture.privateDictionary.id, { id: renewed.googleSub, role: renewed.role }), error => error.statusCode === 404)
  assert.equal((await h.dictionaries.requireDictionary(h.database, fixture.publicDictionary.id, outsider)).ownerId, tombstone.google_sub)
  assert.equal((await h.dictionaries.requireDictionary(h.database, fixture.team.id, reviewer, true)).ownerId, 'bot')
  await assert.rejects(h.dictionaries.requireDictionary(h.database, fixture.team.id, outsider, true), error => error.statusCode === 403)
  const proposal = await h.glossary.decideGlossaryProposal(reviewer, fixture.team.id, fixture.proposals[0], { action: 'resume' })
  assert.equal(proposal.createdBy, tombstone.google_sub)
  assert.equal(proposal.creatorHandle, null)
  assert.deepEqual(JSON.parse(JSON.stringify(proposal.history.slice(0, 3))), fixture.history.map(event => ({ ...event, actor: event.actor === author.id ? tombstone.google_sub : event.actor })))
  const approved = await h.glossary.decideGlossaryProposal(reviewer, fixture.team.id, fixture.proposals[0], { action: 'approve' })
  assert.equal(approved.status, 'approved')
  const [entry] = await h.database`SELECT created_by FROM editor_dictionary_entries WHERE id = ${approved.resultEntryId}`
  assert.equal(entry.created_by, tombstone.google_sub)
  await h.remove(author.id)
  const deleted = await h.database`SELECT google_sub FROM app_users WHERE google_sub LIKE 'deleted:%'`
  assert.equal(new Set(deleted.map(row => row.google_sub)).size, 2)
})

integrationTest('account: public attribution returns tombstones, not former profiles or active Google subjects', async (context) => {
  const h = await harness(context)
  const fixture = await seed(h)
  const notices = h.load('server/utils/notices.ts')
  const comments = h.load('server/utils/editor-comments.ts')
  const logs = h.load('server/utils/editor-log.ts')
  const packs = h.load('server/utils/translation-pack.ts')
  const profile = h.load('server/api/users/[handle].get.ts').default
  const profileEvent = { context: { params: { handle: author.id.replaceAll('-', '') } } }
  assert.equal((await profile(profileEvent)).gameUid, '123456')
  assert.equal((await notices.getNotices()).notices[0].authorId, null)
  assert.equal((await logs.getEditorTranslationLogEntry(fixture.change)).actorId, null)
  assert.equal((await packs.getTranslationPackStatus()).latest.publisherId, null)
  await h.remove(author.id)
  await assert.rejects(profile(profileEvent), error => error.statusCode === 404)
  const [deleted] = await h.database`SELECT google_sub FROM app_users WHERE google_sub LIKE 'deleted:%'`
  for (const item of [(await notices.getNotices()).notices[0], (await comments.getEditorComments({ itemId: fixture.unit })).comments[0]]) {
    assert.equal(item.authorId, deleted.google_sub)
    assert.equal(item.authorHandle, null)
    assert.equal(item.authorRole, 'user')
  }
  const log = await logs.getEditorTranslationLogEntry(fixture.change)
  assert.equal(log.actorId, deleted.google_sub)
  assert.equal(log.reviewerId, deleted.google_sub)
  assert.equal(log.handle, null)
  assert.equal(log.reviewerHandle, null)
  const history = await h.load('server/utils/editor-changes.ts').getEditorHistory(fixture.unit)
  assert.equal(history.entries.length, 2)
  for (const item of history.entries) {
    assert.equal(item.actorId, deleted.google_sub)
    assert.equal(item.actorRole, 'user')
    assert.equal(item.handle, null)
  }
  const sources = await logs.getEditorSourceChanges(fixture.game, 1)
  assert.equal(sources.entries[0].actorId, deleted.google_sub)
  assert.equal(sources.entries[0].handle, null)
  const contributors = await h.load('server/api/contributors.get.ts').default()
  assert.equal(contributors.contributors[0].id, deleted.google_sub)
  assert.equal(contributors.contributors[0].handle, null)
  const publication = (await packs.getTranslationPackStatus()).latest
  assert.equal(publication.publisherId, deleted.google_sub)
  assert.equal(publication.publishedBy, null)
  assert.equal(publication.number, 1)
})

integrationTest('account: team owner migration supports old app writes and restricts accidental personal content deletion', async (context) => {
  const h = await harness(context, { beforeOwnershipMigration: true })
  const team = randomUUID(), personal = randomUUID()
  await h.database`INSERT INTO editor_dictionaries (id, owner_id, name, visibility, is_team)
    VALUES (${team}, ${author.id}, 'Legacy team', 'public', true), (${personal}, ${author.id}, 'Legacy private', 'private', false)`
  await h.database.begin(transaction => transaction.unsafe(ownershipMigration))
  assert.equal((await h.database`SELECT owner_id FROM editor_dictionaries WHERE id = ${team}`)[0].owner_id, 'bot')
  const legacyCreate = randomUUID()
  await h.database`INSERT INTO editor_dictionaries (id, owner_id, name, visibility, is_team)
    VALUES (${legacyCreate}, ${author.id}, 'Old app team creation', 'public', true)`
  await h.database`UPDATE editor_dictionaries SET owner_id = ${reviewer.id} WHERE id = ${team}`
  assert.equal((await h.database`SELECT owner_id FROM editor_dictionaries WHERE id = ${legacyCreate}`)[0].owner_id, 'bot')
  assert.equal((await h.database`SELECT owner_id FROM editor_dictionaries WHERE id = ${team}`)[0].owner_id, 'bot')
  await assert.rejects(h.database`DELETE FROM app_users WHERE google_sub = ${author.id}`)
  assert.equal((await h.database`SELECT google_sub FROM app_users WHERE google_sub = ${author.id}`)[0].google_sub, author.id)
  assert.equal((await h.database`SELECT visibility FROM editor_dictionaries WHERE id = ${personal}`)[0].visibility, 'private')
  const created = await h.dictionaries.createEditorDictionary(reviewer, { name: 'New app team', visibility: 'public', isTeam: true })
  assert.equal(created.ownerId, 'bot')
  assert.equal(created.canEdit, true)
  await assert.rejects(h.dictionaries.createEditorDictionary(outsider, { name: 'Unauthorized', visibility: 'public', isTeam: true }), error => error.statusCode === 403)
})

integrationTest('account: Bot is protected and late failure rolls every identity/content change back', async (context) => {
  const h = await harness(context)
  await seed(h)
  const before = await snapshot(h.database)
  const users = await h.database`SELECT * FROM app_users ORDER BY google_sub`
  await assert.rejects(h.remove('bot'), error => error.statusCode === 403)
  await h.database.unsafe(`CREATE FUNCTION refuse_account_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'forced account deletion failure'; END; $$;
    CREATE TRIGGER refuse_account_delete BEFORE DELETE ON app_users FOR EACH ROW EXECUTE FUNCTION refuse_account_delete();`)
  await assert.rejects(h.remove(author.id), /forced account deletion failure/)
  assert.deepEqual(await snapshot(h.database), before)
  assert.deepEqual(await h.database`SELECT * FROM app_users ORDER BY google_sub`, users)
  assert.equal((await h.database`SELECT * FROM app_user_social_links WHERE user_id = ${author.id}`).length, 1)
})

integrationTest('account: a stale reviewer cannot reintroduce a deleted Google subject into glossary history', async (context) => {
  const h = await harness(context)
  const fixture = await seed(h)
  await h.remove(author.id)
  const before = await snapshot(h.database)
  await assert.rejects(h.glossary.decideGlossaryProposal(author, fixture.team.id, fixture.proposals[1], { action: 'resume' }), error => error.statusCode === 401)
  await h.auth.upsertGoogleUser({ sub: author.id, email: `${author.id}@example.invalid`, email_verified: true })
  await assert.rejects(h.glossary.decideGlossaryProposal(author, fixture.team.id, fixture.proposals[1], { action: 'resume' }), error => error.statusCode === 403)
  assert.deepEqual(await snapshot(h.database), before)
})

integrationTest('account: concurrent author deletion and new-proposal approval both complete without losing attribution', async (context) => {
  const h = await harness(context)
  const fixture = await seed(h)
  await h.glossary.decideGlossaryProposal(reviewer, fixture.team.id, fixture.proposals[0], { action: 'resume' })
  const approvalDb = h.connect()
  const deletionDb = h.connect()
  const barrierDb = h.connect()
  const key = Number.parseInt(randomUUID().slice(0, 8), 16)
  let approval, deletion
  try {
    const [{ pid: approvalPid }] = await approvalDb`SELECT pg_backend_pid() AS pid`
    const [{ pid: deletionPid }] = await deletionDb`SELECT pg_backend_pid() AS pid`
    const [{ pid: barrierPid }] = await barrierDb`SELECT pg_backend_pid() AS pid`
    await h.database.unsafe(`CREATE FUNCTION pause_entry_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN NEW; END; $$;
      CREATE TRIGGER pause_entry_insert BEFORE INSERT ON editor_dictionary_entries FOR EACH ROW EXECUTE FUNCTION pause_entry_insert();`)
    await barrierDb`SELECT pg_advisory_lock(${key}::bigint)`
    approval = modules(approvalDb).load('server/utils/editor-dictionary/glossary.ts')
      .decideGlossaryProposal(reviewer, fixture.team.id, fixture.proposals[0], { action: 'approve' })
    void approval.catch(() => {})
    await waitForBlock(h.database, approvalPid, barrierPid)
    deletion = modules(deletionDb).load('server/utils/user-account.ts').deleteUserAccount(author.id)
    const results = Promise.allSettled([approval, deletion])
    await waitForBlock(h.database, deletionPid, approvalPid)
    await barrierDb`SELECT pg_advisory_unlock(${key}::bigint)`
    for (const result of await results) {
      if (result.status === 'rejected') throw result.reason
    }
    const [proposal] = await h.database`SELECT status, created_by, history, result_entry_id FROM editor_dictionary_proposals WHERE id = ${fixture.proposals[0]}`
    assert.equal(proposal.status, 'approved')
    assert.match(proposal.created_by, /^deleted:/)
    assert.equal(proposal.history.at(-1).actor, reviewer.id)
    const [entry] = await h.database`SELECT translation, created_by FROM editor_dictionary_entries WHERE id = ${proposal.result_entry_id}`
    assert.equal(entry.created_by, proposal.created_by)
    assert.equal(entry.translation, '스타 코인')
    assert.equal((await h.database`SELECT google_sub FROM app_users WHERE google_sub = ${author.id}`).length, 0)
  } finally {
    await barrierDb`SELECT pg_advisory_unlock_all()`
    await Promise.allSettled([approval, deletion].filter(Boolean))
    await Promise.all([approvalDb.end({ timeout: 5 }), deletionDb.end({ timeout: 5 }), barrierDb.end({ timeout: 5 })])
  }
})

integrationTest('account: ownership migration serializes a concurrent legacy team insert before normalization', async (context) => {
  const h = await harness(context, { beforeOwnershipMigration: true })
  const legacyDb = h.connect()
  const migrationDb = h.connect()
  const dictionaryId = randomUUID()
  let outcome, committed = false
  try {
    const [{ pid: legacyPid }] = await legacyDb`SELECT pg_backend_pid() AS pid`
    const [{ pid: migrationPid }] = await migrationDb`SELECT pg_backend_pid() AS pid`
    await legacyDb`BEGIN`
    await legacyDb`INSERT INTO editor_dictionaries (id, owner_id, name, visibility, is_team)
      VALUES (${dictionaryId}, ${author.id}, 'Concurrent legacy team', 'public', true)`
    outcome = migrationDb.begin(transaction => transaction.unsafe(ownershipMigration)).then(() => null, error => error)
    await waitForBlock(h.database, migrationPid, legacyPid)
    await legacyDb`COMMIT`
    committed = true
    const error = await outcome
    if (error) throw error
    const [dictionary] = await h.database`SELECT owner_id FROM editor_dictionaries WHERE id = ${dictionaryId}`
    assert.equal(dictionary.owner_id, 'bot')
  } finally {
    if (!committed) await legacyDb`ROLLBACK`
    await outcome
    await Promise.all([legacyDb.end({ timeout: 5 }), migrationDb.end({ timeout: 5 })])
  }
})
