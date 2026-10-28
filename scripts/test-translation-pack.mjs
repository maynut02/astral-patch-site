import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { gunzipSync } from 'node:zlib'
import postgres from 'postgres'
import ts from 'typescript'

// Run with TEST_DATABASE_URL pointing at a disposable PostgreSQL database:
// node scripts/test-translation-pack.mjs
// Every case owns a random schema. No DATABASE_URL fallback, SQL mocks, external R2
// calls, or permanent database dependencies are used. Without the explicit URL,
// integration cases are reported as skipped, not as passing MVCC/rollback coverage.
const databaseUrl = process.env.TEST_DATABASE_URL
const require = createRequire(import.meta.url)
const nuxtRequire = createRequire(require.resolve('nuxt/package.json'))
const { createError } = await import(pathToFileURL(nuxtRequire.resolve('h3')).href)
const sourcePath = 'server/utils/translation-pack.ts'
const compiled = ts.transpileModule(await readFile(new URL(`../${sourcePath}`, import.meta.url), 'utf8'), {
  fileName: sourcePath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const migrationsDirectory = new URL('../database/migrations/', import.meta.url)
// Only publisher prerequisites: unrelated migration 0015 deliberately targets public.
const migrationNames = [
  '0001_initial.sql',
  '0010_translation_change_kind.sql',
  '0017_translation_pack_publications.sql',
  '0018_translation_change_publication.sql'
]
const migrations = new Map(await Promise.all(migrationNames.map(async name => [name, await readFile(new URL(name, migrationsDirectory), 'utf8')])))
const publicationMigration = '0018_translation_change_publication.sql'
const publisher = { id: 'bot', handle: 'Bot', role: 'bot' }
const pointerKey = 'translation-pack/latest.json'

function integrationTest(name, operation) {
  test(name, { skip: databaseUrl ? false : 'Set TEST_DATABASE_URL to run isolated PostgreSQL coverage', timeout: 30_000 }, operation)
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function createHarness(context, { beforePublicationMigration = false } = {}) {
  const schema = `translation_pack_test_${randomUUID().replaceAll('-', '')}`
  const options = { prepare: false, connect_timeout: 5, onnotice: () => {} }
  const control = postgres(databaseUrl, { ...options, max: 1 })
  let database
  let created = false
  context.after(async () => {
    try {
      // end() drains the publisher's post-commit retention query before dropping data.
      if (database) await database.end({ timeout: 5 })
      if (created) await control`DROP SCHEMA ${control(schema)} CASCADE`
    } finally {
      await control.end({ timeout: 5 })
    }
  })
  await control`CREATE SCHEMA ${control(schema)}`
  created = true
  database = postgres(databaseUrl, {
    ...options,
    max: 5,
    connection: { search_path: schema, statement_timeout: '10000', lock_timeout: '2000' }
  })
  for (const [name, sql] of migrations) {
    if (beforePublicationMigration && name >= publicationMigration) continue
    await database.unsafe(sql)
  }

  const harness = {
    database, uploads: [], objects: new Map(), broadcasts: [], logs: [], commitCount: 0,
    afterQuery: null, onPut: null
  }
  // Observe results of real PostgreSQL queries, without matching/replacing SQL or
  // simulating isolation. A test can commit an approval immediately after the real
  // pack SELECT finishes and before the publisher reads/updates history.
  const observe = client => Object.assign(async (strings, ...values) => {
    const rows = await client(strings, ...values)
    if (harness.afterQuery) await harness.afterQuery(rows)
    return rows
  }, {
    async begin(options, operation) {
      const result = await client.begin(options, transaction => operation(observe(transaction)))
      harness.commitCount++
      return result
    }
  })
  const boundaries = {
    './database': { getDatabase: () => observe(database) },
    './r2': {
      getTranslationPackBucketConfig: () => ({ bucket: 'test-only' }),
      async putR2Object(_config, key, body, metadata) {
        const upload = { key, body: Buffer.from(body), metadata }
        harness.uploads.push(upload)
        if (harness.onPut) await harness.onPut(upload)
        harness.objects.set(key, upload)
      },
      async deleteR2Object(_config, key) { harness.objects.delete(key) }
    },
    './server-log': { logServerError: (...args) => harness.logs.push(args) },
    './ws-hub': {
      broadcastWsMessage(message, topics) {
        harness.broadcasts.push({
          message: JSON.parse(JSON.stringify(message)), topics: Array.from(topics),
          commitCount: harness.commitCount
        })
      }
    },
    'h3': { createError }
  }
  const module = { exports: {} }
  runInNewContext(compiled, {
    module, exports: module.exports, Buffer, Date,
    require: (name) => {
      if (name in boundaries) return boundaries[name]
      assert.ok(name.startsWith('node:'), `Unexpected publisher dependency: ${name}`)
      return require(name)
    }
  }, { filename: sourcePath })
  harness.publish = () => module.exports.publishTranslationPack(publisher)
  harness.migratePublicationLinks = () => database.unsafe(migrations.get(publicationMigration))
  harness.game = await addGame(database)
  return harness
}

async function addGame(database, { gameVersion = '1.0.0', revision = '100', detectedAt = '2020-01-01T00:00:00Z' } = {}) {
  const id = randomUUID()
  await database`
    INSERT INTO game_revisions (id, route, game_version, revision, source_url, catalog_url, catalog_sha256, detected_at, processed_at)
    VALUES (${id}, 'INT_STEAM', ${gameVersion}, ${revision}, 'https://test.invalid/source', 'https://test.invalid/catalog', ${'0'.repeat(64)}, ${detectedAt}, now())
  `
  return { id, gameVersion, revision }
}

async function addUnit(harness, { kind = 'lang', namespace = 'dialogue', unitKey = randomUUID() } = {}) {
  const id = randomUUID()
  const sourceVersionId = randomUUID()
  await harness.database`
    INSERT INTO translation_units (id, kind, namespace, unit_key)
    VALUES (${id}, ${kind}, ${namespace}, ${unitKey})
  `
  await harness.database`
    INSERT INTO source_versions (id, unit_id, en, source_fingerprint, first_seen_revision_id)
    VALUES (${sourceVersionId}, ${id}, 'Original', ${'1'.repeat(64)}, ${harness.game.id})
  `
  await harness.database`UPDATE translation_units SET current_source_version_id = ${sourceVersionId} WHERE id = ${id}`
  return { id, sourceVersionId, kind, namespace, unitKey }
}

async function applyTranslation(database, change) {
  await database`
    INSERT INTO translations (id, unit_id, locale, text, approved_source_version_id, applied_change_id, approved_by)
    VALUES (${randomUUID()}, ${change.unit.id}, ${change.locale}, ${change.text}, ${change.unit.sourceVersionId}, ${change.id}, 'bot')
    ON CONFLICT (unit_id, locale) DO UPDATE SET
      text = EXCLUDED.text,
      approved_source_version_id = EXCLUDED.approved_source_version_id,
      applied_change_id = EXCLUDED.applied_change_id,
      approved_by = EXCLUDED.approved_by,
      approved_at = now(), updated_at = now()
  `
}

async function addChange(database, unit, { text, locale = 'ko', status = 'approved', changeKind = 'translation_edit', previousText = null } = {}) {
  const change = { id: randomUUID(), groupId: randomUUID(), unit, text, locale }
  await database`INSERT INTO translation_change_groups (id, title) VALUES (${change.groupId}, 'Regression change')`
  await database`
    INSERT INTO translation_changes (id, group_id, unit_id, locale, source_version_id, previous_text, proposed_text, status, change_kind, reviewed_by, reviewed_at)
    VALUES (
      ${change.id}, ${change.groupId}, ${unit.id}, ${locale}, ${unit.sourceVersionId}, ${previousText}, ${text}, ${status}, ${changeKind},
      ${status === 'pending' ? null : 'bot'}, ${status === 'pending' ? null : new Date('2020-01-01T00:00:00Z')}
    )
  `
  if (status === 'approved') await applyTranslation(database, change)
  return change
}

async function approveChange(database, change) {
  // Deliberately old reviewed_at: visibility, not a wall-clock cutoff, defines a batch.
  await database`
    UPDATE translation_changes SET status = 'approved', reviewed_by = 'bot', reviewed_at = '2000-01-01T00:00:00Z'
    WHERE id = ${change.id}
  `
  await applyTranslation(database, change)
}

async function seedOldPublication(database) {
  const [row] = await database`SELECT nextval('translation_pack_number_seq')::int AS number`
  await database`
    INSERT INTO translation_pack_publications (number, game_version, revision, object_key, byte_size, gzip_byte_size, gzip_sha256, lang_count, str_count, published_by)
    VALUES (${row.number}, '0.9.0', '90', ${`translation-pack/packs/${row.number}.json.gz`}, 1, 1, ${'0'.repeat(64)}, 0, 0, 'bot')
  `
  return row.number
}

async function assignments(database) {
  const rows = await database`SELECT id, pack_number AS "packNumber" FROM translation_changes`
  return new Map(rows.map(row => [row.id, row.packNumber]))
}

function readPack(harness, publication) {
  const pointerUpload = harness.objects.get(pointerKey)
  assert.ok(pointerUpload, 'latest.json is activated')
  const pointer = JSON.parse(pointerUpload.body.toString('utf8'))
  assert.equal(pointer.number, publication.number)
  assert.equal(pointer.version, publication.gameVersion)
  assert.equal(pointer.revision, publication.revision)
  assert.equal(pointer.path, `packs/${publication.number}.json.gz`)
  assert.equal(pointerUpload.metadata.cacheControl, 'no-cache')
  const immutable = harness.objects.get(`translation-pack/${pointer.path}`)
  assert.ok(immutable, 'the pointer resolves to an uploaded immutable pack')
  assert.equal(immutable.metadata.cacheControl, 'public, max-age=31536000, immutable')
  assert.equal(pointer.size, immutable.body.byteLength)
  assert.equal(pointer.sha256, createHash('sha256').update(immutable.body).digest('hex'))
  const pack = JSON.parse(gunzipSync(immutable.body).toString('utf8'))
  assert.equal(pack.schemaVersion, 1)
  assert.equal(pack.locale, 'ko')
  assert.equal(pack.pack.number, publication.number)
  assert.equal(pack.pack.version, pointer.version)
  assert.equal(pack.pack.revision, pointer.revision)
  assert.equal(pack.pack.publishedAt, pointer.publishedAt)
  return pack
}

integrationTest('the first post-migration pack claims the whole approved ko backlog; later packs preserve old links', async (context) => {
  const harness = await createHarness(context, { beforePublicationMigration: true })
  const { database } = harness
  const unit = await addUnit(harness, { unitKey: 'greeting' })
  const approved = []
  for (const text of ['A', 'B', 'C']) approved.push(await addChange(database, unit, { text }))
  approved.push(await addChange(database, unit, { text: 'C', previousText: 'C', changeKind: 'retain_confirmation' }))
  const strUnit = await addUnit(harness, { kind: 'str', namespace: 'UI', unitKey: 'Title' })
  approved.push(await addChange(database, strUnit, { text: '제목\r\n둘째\r셋째' }))
  const pending = await addChange(database, unit, { text: 'D', status: 'pending' })
  const excluded = [
    pending,
    await addChange(database, unit, { text: 'Rejected', status: 'rejected' }),
    await addChange(database, unit, { text: 'Superseded', status: 'superseded' }),
    await addChange(database, unit, { text: 'English', locale: 'en' })
  ]
  const oldPublication = await seedOldPublication(database)
  await harness.migratePublicationLinks()
  assert.ok([...(await assignments(database)).values()].every(number => number === null), 'migration never guesses an old pack')
  harness.onPut = async (upload) => {
    if (upload.key !== pointerKey) return
    assert.equal(harness.broadcasts.length, 0)
    const rows = await database`SELECT number FROM translation_pack_publications WHERE number > ${oldPublication}`
    assert.equal(rows.length, 0, 'publication is uncommitted until the pointer upload succeeds')
    assert.ok([...(await assignments(database)).values()].every(number => number === null))
  }
  const first = await harness.publish()
  assert.ok(first.number > oldPublication)
  let linked = await assignments(database)
  for (const change of approved) assert.equal(linked.get(change.id), first.number)
  for (const change of excluded) assert.equal(linked.get(change.id), null)
  const pack = readPack(harness, first)
  assert.deepEqual(pack.lang, { greeting: 'C' })
  assert.deepEqual(pack.str, { UI: { Title: '제목\n둘째\n셋째' } })
  assert.equal(first.langCount, 1)
  assert.equal(first.strCount, 1)
  assert.deepEqual(harness.broadcasts, [{ message: { type: 'TRANSLATION_PACK_PUBLISHED' }, topics: ['editor', 'change:translation'], commitCount: 1 }])

  harness.onPut = null
  await database.begin(transaction => approveChange(transaction, pending))
  const second = await harness.publish()
  linked = await assignments(database)
  assert.equal(linked.get(pending.id), second.number)
  for (const change of approved) assert.equal(linked.get(change.id), first.number, 'an existing association is immutable')
  for (const change of excluded.slice(1)) assert.equal(linked.get(change.id), null)
  assert.deepEqual(readPack(harness, second).lang, { greeting: 'D' })
  assert.equal(harness.broadcasts[1].commitCount, 2)
})

for (const failingObject of ['pack', 'pointer']) {
  integrationTest(`${failingObject} upload failure rolls back publication and history, emits no event, and never reuses its number`, async (context) => {
    const harness = await createHarness(context)
    const { database } = harness
    const unit = await addUnit(harness, { unitKey: 'failure' })
    const initial = await addChange(database, unit, { text: 'Old' })
    const first = await harness.publish()
    const previousPointer = Buffer.from(harness.objects.get(pointerKey).body)
    const next = await addChange(database, unit, { text: 'New' })
    const failure = new Error(`Deliberate ${failingObject} upload failure`)
    harness.onPut = async (upload) => {
      if ((upload.key === pointerKey) === (failingObject === 'pointer')) throw failure
    }
    await assert.rejects(harness.publish(), error => error === failure)
    const linked = await assignments(database)
    assert.equal(linked.get(initial.id), first.number)
    assert.equal(linked.get(next.id), null)
    const rows = await database`SELECT number FROM translation_pack_publications ORDER BY number`
    assert.deepEqual(rows.map(row => row.number), [first.number])
    assert.equal(harness.broadcasts.length, 1, 'failed transactions never broadcast')
    assert.deepEqual(harness.objects.get(pointerKey).body, previousPointer)
    const failedPackUpload = harness.uploads.find(upload => upload.key !== pointerKey && upload.key !== `translation-pack/packs/${first.number}.json.gz`)
    assert.ok(failedPackUpload)
    const failedNumber = JSON.parse(gunzipSync(failedPackUpload.body).toString('utf8')).pack.number
    harness.onPut = null
    const retry = await harness.publish()
    assert.ok(retry.number > failedNumber)
    assert.equal((await assignments(database)).get(next.id), retry.number)
    assert.deepEqual(readPack(harness, retry).lang, { failure: 'New' })
    assert.equal(harness.broadcasts.length, 2)
    assert.equal(harness.logs.length, 0)
  })
}

integrationTest('approvals between pack read and history assignment, and during upload, remain for the next snapshot', async (context) => {
  const harness = await createHarness(context)
  const { database } = harness
  const unit = await addUnit(harness, { unitKey: 'snapshot' })
  const old = await addChange(database, unit, { text: 'Before' })
  const next = await addChange(database, unit, { text: 'After read', status: 'pending' })
  const uploadUnit = await addUnit(harness, { unitKey: 'during-upload' })
  const duringUpload = await addChange(database, uploadUnit, { text: 'After assignment', status: 'pending' })
  const transactionStarted = deferred()
  const approveAfterSnapshot = deferred()
  // Start the approval transaction before the publisher establishes its snapshot.
  const approval = database.begin(async (transaction) => {
    await transaction`SELECT now()`
    transactionStarted.resolve()
    await approveAfterSnapshot.promise
    await approveChange(transaction, next)
  })
  await transactionStarted.promise
  let readObserved = false
  harness.afterQuery = async (rows) => {
    if (readObserved || !rows.some(row => row.unitKey === 'snapshot' && row.text === 'Before')) return
    readObserved = true
    approveAfterSnapshot.resolve()
    await approval
    await addGame(database, { gameVersion: '2.0.0', revision: '200', detectedAt: '2030-01-01T00:00:00Z' })
  }
  let uploadObserved = false
  harness.onPut = async (upload) => {
    if (upload.key === pointerKey || uploadObserved) return
    uploadObserved = true
    await database.begin(transaction => approveChange(transaction, duringUpload))
  }
  let first
  try {
    first = await harness.publish()
  } finally {
    approveAfterSnapshot.resolve()
    await approval
  }
  assert.ok(readObserved)
  assert.ok(uploadObserved, 'approvals are not blocked by broad locks during uploads')
  const pack = readPack(harness, first)
  assert.equal(pack.pack.version, '1.0.0', 'revision shares the translation snapshot')
  assert.deepEqual(pack.lang, { snapshot: 'Before' })
  let linked = await assignments(database)
  assert.equal(linked.get(old.id), first.number)
  assert.equal(linked.get(next.id), null)
  assert.equal(linked.get(duringUpload.id), null)
  harness.afterQuery = null
  harness.onPut = null
  const second = await harness.publish()
  linked = await assignments(database)
  assert.equal(linked.get(old.id), first.number)
  assert.equal(linked.get(next.id), second.number)
  assert.equal(linked.get(duringUpload.id), second.number)
  assert.deepEqual(readPack(harness, second).lang, { 'during-upload': 'After assignment', 'snapshot': 'After read' })
  assert.equal(second.gameVersion, '2.0.0')
  assert.equal(second.revision, '200')
})

integrationTest('overlapping publication is rejected without activating another pointer or emitting another event', async (context) => {
  const harness = await createHarness(context)
  const unit = await addUnit(harness, { unitKey: 'overlap' })
  const change = await addChange(harness.database, unit, { text: 'Published once' })
  const uploadReached = deferred()
  const releaseUpload = deferred()
  harness.onPut = async (upload) => {
    if (upload.key === pointerKey) return
    uploadReached.resolve()
    await releaseUpload.promise
  }
  const first = harness.publish()
  let publication
  try {
    await Promise.race([uploadReached.promise, first.then(() => assert.fail('publication finished before its upload was released'))])
    await assert.rejects(harness.publish(), error => error.statusCode === 409)
    assert.equal(harness.broadcasts.length, 0)
    assert.equal(harness.uploads.length, 1)
  } finally {
    releaseUpload.resolve()
    publication = await first
  }
  assert.equal(harness.broadcasts.length, 1)
  assert.equal((await assignments(harness.database)).get(change.id), publication.number)
  assert.deepEqual(readPack(harness, publication).lang, { overlap: 'Published once' })
})

integrationTest('database constraints reject publication links on proposals and nonexistent publication numbers', async (context) => {
  const harness = await createHarness(context)
  const { database } = harness
  const unit = await addUnit(harness)
  const approved = await addChange(database, unit, { text: 'Approved' })
  const publication = await harness.publish()
  for (const status of ['pending', 'rejected', 'superseded']) {
    const proposal = await addChange(database, unit, { text: status, status })
    await assert.rejects(database`
      UPDATE translation_changes SET pack_number = ${publication.number} WHERE id = ${proposal.id}
    `, error => error.code === '23514' && error.constraint_name === 'translation_changes_pack_approved_check')
  }
  await assert.rejects(database`
    UPDATE translation_changes SET pack_number = ${publication.number + 1000} WHERE id = ${approved.id}
  `, error => error.code === '23503')
  assert.equal((await assignments(database)).get(approved.id), publication.number)
})
