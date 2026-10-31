import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { publicDataId, PUBLIC_TRANSLATION_ORIGIN } from './sync-public-translations.mjs'

export const BASE_GLOSSARY_ID = '82699bf0-3c4e-4126-b667-6ccf6f31409a'
export async function seedBaseGlossary(database, data) {
  if (data?.origin !== PUBLIC_TRANSLATION_ORIGIN || !Array.isArray(data.terms) || data.terms.length > 200) throw new Error('기초 용어 데이터가 올바르지 않습니다.')
  const result = { added: 0, existing: 0, skipped: [] }
  await database.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('astral-base-glossary', 0))`
    await sql`INSERT INTO editor_dictionaries (id, owner_id, name, description, visibility, is_team)
      VALUES (${BASE_GLOSSARY_ID}, 'bot', '공통 번역 기준', '기존 한국어 번역에서 정리한 기초 용어', 'public', true) ON CONFLICT (id) DO NOTHING`
    for (const term of data.terms) {
      const [source] = await sql`SELECT source_version_id, jp, cn_s, cn_t, approved_text, approved_for_current_source FROM translation_workbench
        WHERE namespace || '_' || unit_key = ${term.key} LIMIT 1`
      if (!source || source.source_version_id !== term.sourceVersionId || !source.approved_for_current_source || !source.approved_text?.includes(term.translation)
        || ![term.japanese, term.chineseSimplified, term.chineseTraditional].some(Boolean)
        || [[source.jp, term.japanese], [source.cn_s, term.chineseSimplified], [source.cn_t, term.chineseTraditional]].some(([text, expression]) => expression && !text.includes(expression))) {
        result.skipped.push(term.key)
        continue
      }
      const [existing] = await sql`SELECT id FROM editor_dictionary_entries WHERE dictionary_id = ${BASE_GLOSSARY_ID}
        AND (id = ${publicDataId('base-glossary:' + term.key + ':' + term.translation)} OR
          (metadata->>'kind' = 'term' AND ((${Boolean(term.japanese)} AND metadata->>'japanese' = ${term.japanese})
            OR (${Boolean(term.chineseSimplified)} AND metadata->>'chineseSimplified' = ${term.chineseSimplified})
            OR (${Boolean(term.chineseTraditional)} AND metadata->>'chineseTraditional' = ${term.chineseTraditional})))) LIMIT 1`
      if (existing) {
        result.existing++
        continue
      }
      const metadata = {
        archived: false, kind: 'term', japanese: term.japanese, chineseSimplified: term.chineseSimplified, chineseTraditional: term.chineseTraditional,
        allowed: [], historical: [], discouraged: [], scope: 'project', target: '', semanticReview: 'unrecorded', semanticNote: '', evidenceKey: term.key,
        speechStyle: '', selfAddress: '', otherAddress: '', endings: '', exceptions: '', exampleSource: '', exampleTranslation: ''
      }
      await sql`INSERT INTO editor_dictionary_entries (id, dictionary_id, source_text, translation, note, metadata, created_by)
        VALUES (${publicDataId('base-glossary:' + term.key + ':' + term.translation)}, ${BASE_GLOSSARY_ID}, ${term.japanese || term.chineseSimplified || term.chineseTraditional},
          ${term.translation}, ${term.note}, ${sql.json(metadata)}, 'bot')`
      result.added++
    }
  })
  return result
}
async function main() {
  const url = process.env.ASTRAL_MIRROR_DATABASE_URL
  if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw new Error('ASTRAL_MIRROR_DATABASE_URL에 로컬 사본 DB를 지정해 주세요.')
  const data = JSON.parse(await readFile(new URL('../data/glossary-base.json', import.meta.url), 'utf8'))
  const database = postgres(url, { max: 1, onnotice: () => {} })
  try {
    console.log(JSON.stringify(await seedBaseGlossary(database, data)))
  } finally { await database.end({ timeout: 5 }) }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
