import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const base = new URL(process.env.ASTRAL_SMOKE_BASE_URL || 'http://127.0.0.1:55435')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('배포 검증은 로컬 후보 서버에서만 실행합니다.')
const checks = []
async function request(path, options) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(5000), ...options })
  return response
}
let healthy = false
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await request('/api/editor/overview')
    if (response.ok && typeof (await response.json()).overall?.total === 'number') {
      healthy = true
      break
    }
  } catch {
    healthy = false
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
}
assert.equal(healthy, true, 'production image can query the migrated database')
checks.push('production image can query the migrated database')
const dictionaries = await request('/api/editor/dictionaries')
assert.equal(dictionaries.status, 200)
assert.ok(Array.isArray((await dictionaries.json()).dictionaries))
checks.push('public glossary API responds')
const glossary = await request('/translate/glossary')
assert.equal(glossary.status, 200)
assert.match(await glossary.text(), /공통 용어집/)
checks.push('glossary page renders')
const missing = await request('/api/editor/glossary/related?itemId=00000000-0000-4000-8000-000000000001')
assert.equal(missing.status, 404)
checks.push('related-term endpoint rejects a missing source cleanly')
const unauthorized = await request('/api/editor/dictionaries/00000000-0000-4000-8000-000000000001/proposals', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': base.origin }, body: '{}'
})
assert.equal(unauthorized.status, 401)
checks.push('anonymous glossary writes are rejected')
const oldBulk = await request('/api/editor/dictionaries/00000000-0000-4000-8000-000000000001/harvest/submit', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': base.origin }, body: '{}'
})
assert.equal(oldBulk.status, 404)
checks.push('removed bulk glossary API stays unavailable')
const migration = await readFile(new URL('../database/migrations/0020_base_glossary.sql', import.meta.url))
const report = { revision: process.env.GITHUB_SHA || null, verifiedAt: new Date().toISOString(), checks, migrationSha256: createHash('sha256').update(migration).digest('hex') }
await mkdir(new URL('../.data/', import.meta.url), { recursive: true })
await writeFile(new URL('../.data/release-smoke.json', import.meta.url), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
