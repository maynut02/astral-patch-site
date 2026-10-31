import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { renderBaseGlossarySql } from './base-glossary-sql.mjs'

export { BASE_GLOSSARY_ID } from './base-glossary-sql.mjs'
export async function seedBaseGlossary(database, data) {
  const contents = renderBaseGlossarySql(data)
  return database.begin(async (sql) => {
    await sql.unsafe(contents)
    const [row] = await sql`SELECT current_setting('astral.base_glossary_result')::jsonb AS result`
    return row.result
  })
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
