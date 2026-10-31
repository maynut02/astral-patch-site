import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'

export const PUBLIC_TRANSLATION_ORIGIN = 'https://astral.maynutlab.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function publicDataId(text) {
  const hash = createHash('sha256').update(text).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
export function validatePublicSnapshot(snapshot) {
  if (snapshot?.origin !== PUBLIC_TRANSLATION_ORIGIN || !Array.isArray(snapshot.items) || !Number.isSafeInteger(snapshot.total) || snapshot.total < 1 || snapshot.total > 100_000 || snapshot.items.length !== snapshot.total) throw new Error('공개 번역 데이터가 불완전합니다.')
  const ids = new Set()
  for (const row of snapshot.items) {
    if (!UUID.test(row.id) || !UUID.test(row.sourceVersionId) || !['str', 'lang'].includes(row.kind) || !row.category || !row.unitKey || !['category', 'unitKey', 'jp', 'cnS', 'cnT', 'en', 'ko'].every(field => typeof row[field] === 'string') || ![true, false, null].includes(row.approvedForCurrentSource) || (row.pendingKo !== null && row.pendingKo !== undefined && typeof row.pendingKo !== 'string') || ids.has(row.id)) throw new Error('공개 번역 항목의 ID·원문·상태를 확인해 주세요.')
    ids.add(row.id)
  }
  return snapshot
}
export async function fetchPublicSnapshot(fetcher = fetch) {
  async function page(number) {
    const response = await fetcher(`${PUBLIC_TRANSLATION_ORIGIN}/api/editor/items?page=${number}`, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`공개 번역 조회 실패: HTTP ${response.status}`)
    return response.json()
  }
  const first = await page(1)
  if (!Number.isSafeInteger(first.totalPages) || first.totalPages < 1 || first.totalPages > 2000) throw new Error('공개 번역 페이지 수가 올바르지 않습니다.')
  const pages = [first]
  for (let start = 2; start <= first.totalPages; start += 4) {
    pages.push(...await Promise.all(Array.from({ length: Math.min(4, first.totalPages - start + 1) }, (_, index) => page(start + index))))
  }
  if (pages.some(row => row.total !== first.total || row.totalPages !== first.totalPages || !Array.isArray(row.items))) throw new Error('조회 중 운영 데이터가 바뀌었습니다. 다시 동기화해 주세요.')
  return validatePublicSnapshot({ origin: PUBLIC_TRANSLATION_ORIGIN, fetchedAt: new Date().toISOString(), total: first.total, items: pages.flatMap(row => row.items) })
}

export async function importPublicSnapshot(database, input) {
  const snapshot = validatePublicSnapshot(input)
  const contentHash = createHash('sha256').update(JSON.stringify(snapshot.items.map(row => [row.id, row.sourceVersionId, row.ko, row.pendingKo, row.approvedForCurrentSource]))).digest('hex')
  const groupId = publicDataId(PUBLIC_TRANSLATION_ORIGIN + ':translations:' + contentHash)
  const revisionId = publicDataId(PUBLIC_TRANSLATION_ORIGIN + ':observed-source')
  return database.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('astral-public-mirror', 0))`
    await sql`INSERT INTO game_revisions (id, route, game_version, revision, source_url, catalog_url, catalog_sha256, processed_at)
      VALUES (${revisionId}, 'PUBLIC_SNAPSHOT', 'public-api', '1', ${PUBLIC_TRANSLATION_ORIGIN}, ${PUBLIC_TRANSLATION_ORIGIN + '/api/editor/items'}, ${createHash('sha256').update(JSON.stringify(snapshot.items)).digest('hex')}, now())
      ON CONFLICT (id) DO UPDATE SET processed_at = now(), catalog_sha256 = EXCLUDED.catalog_sha256`
    await sql`INSERT INTO translation_change_groups (id, title, description, created_by)
      VALUES (${groupId}, '공개 번역 동기화', ${PUBLIC_TRANSLATION_ORIGIN + '의 승인 번역 사본. 원래 작성자·검토 이력을 대신하지 않습니다.'}, 'bot') ON CONFLICT (id) DO NOTHING`
    let imported = 0
    for (let offset = 0; offset < snapshot.items.length; offset += 250) {
      const items = snapshot.items.slice(offset, offset + 250)
      await sql`INSERT INTO translation_units ${sql(items.map(row => ({ id: row.id, kind: row.kind, namespace: row.category, unit_key: row.unitKey })))}
        ON CONFLICT (id) DO NOTHING`
      const versions = items.map(row => ({ id: row.sourceVersionId, unit_id: row.id, cn_s: row.cnS, en: row.en, jp: row.jp, cn_t: row.cnT,
        source_fingerprint: createHash('sha256').update(JSON.stringify([row.cnS, row.en, row.jp, row.cnT])).digest('hex'), first_seen_revision_id: revisionId }))
      const previous = await sql`SELECT id, source_fingerprint FROM source_versions WHERE id = ANY(${sql.array(versions.map(row => row.id))}::uuid[])`
      if (previous.some(row => versions.find(version => version.id === row.id)?.source_fingerprint !== row.source_fingerprint)) throw new Error('같은 원문 버전의 내용이 바뀌었습니다. 기존 데이터를 보존하고 동기화를 중단합니다.')
      await sql`INSERT INTO source_versions ${sql(versions)} ON CONFLICT (id) DO NOTHING`
      await sql`UPDATE translation_units u SET current_source_version_id = source.id
        FROM source_versions source WHERE source.id = ANY(${sql.array(versions.map(row => row.id))}::uuid[]) AND source.unit_id = u.id`
      const eligible = items.filter(row => row.approvedForCurrentSource === true && !row.pendingKo && row.ko.trim())
      if (!eligible.length) continue
      const changes = eligible.map(row => ({ id: publicDataId(`public-translation:${row.id}:${row.sourceVersionId}:${row.ko}`), group_id: groupId,
        unit_id: row.id, locale: 'ko', source_version_id: row.sourceVersionId, proposed_text: row.ko, status: 'approved', change_kind: 'translation_edit', created_by: 'bot', reviewed_by: 'bot', reviewed_at: new Date() }))
      await sql`INSERT INTO translation_changes ${sql(changes)} ON CONFLICT (id) DO NOTHING`
      const translations = eligible.map((row, index) => ({ id: publicDataId('public-ko:' + row.id), unit_id: row.id, locale: 'ko', text: row.ko,
        approved_source_version_id: row.sourceVersionId, applied_change_id: changes[index].id, approved_by: 'bot' }))
      const saved = await sql`INSERT INTO translations ${sql(translations)}
        ON CONFLICT (unit_id, locale) DO UPDATE SET text = EXCLUDED.text, approved_source_version_id = EXCLUDED.approved_source_version_id,
          applied_change_id = EXCLUDED.applied_change_id, approved_by = EXCLUDED.approved_by, updated_at = now()
        WHERE EXISTS (SELECT 1 FROM translation_changes previous JOIN translation_change_groups origin ON origin.id = previous.group_id
          WHERE previous.id = translations.applied_change_id AND origin.title = '공개 번역 동기화' AND origin.created_by = 'bot')
        RETURNING unit_id`
      imported += saved.length
    }
    return { total: snapshot.total, approved: imported, skippedApproval: snapshot.items.filter(row => !row.approvedForCurrentSource || row.pendingKo || !row.ko.trim()).length, fetchedAt: snapshot.fetchedAt }
  })
}

function mirrorDatabaseUrl() {
  const value = process.env.ASTRAL_MIRROR_DATABASE_URL
  if (!value || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) throw new Error('ASTRAL_MIRROR_DATABASE_URL에 로컬 사본 DB를 지정해 주세요. 운영 DB는 사용하지 않습니다.')
  return value
}
async function main() {
  await mkdir(new URL('../.data/', import.meta.url), { recursive: true })
  const database = postgres(mirrorDatabaseUrl(), { max: 1, onnotice: () => {} })
  const snapshotIndex = process.argv.indexOf('--snapshot')
  const watch = process.argv.includes('--watch')
  if (watch && snapshotIndex !== -1) throw new Error('--watch는 운영 공개 API에서 조회할 때만 사용할 수 있습니다.')
  let stopped = false
  process.once('SIGINT', () => {
    stopped = true
  })
  process.once('SIGTERM', () => {
    stopped = true
  })
  try {
    do {
      try {
        const snapshot = snapshotIndex === -1 ? await fetchPublicSnapshot() : validatePublicSnapshot(JSON.parse(await readFile(process.argv[snapshotIndex + 1], 'utf8')))
        const result = await importPublicSnapshot(database, snapshot)
        await writeFile(new URL('../.data/public-source-status.json', import.meta.url), JSON.stringify(result, null, 2))
        console.log(JSON.stringify(result))
      } catch (error) {
        if (!watch) throw error
        console.error('공개 번역 동기화 실패. 기존 사본을 유지합니다:', error.message)
      }
      if (watch && !stopped) {
        for (let seconds = 0; seconds < 900 && !stopped; seconds++) await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } while (watch && !stopped)
  } finally { await database.end({ timeout: 5 }) }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
