import { readFile, writeFile } from 'node:fs/promises'
import { renderBaseGlossarySql } from './base-glossary-sql.mjs'

const data = JSON.parse(await readFile(new URL('../data/glossary-base.json', import.meta.url), 'utf8'))
const path = new URL('../database/migrations/0020_base_glossary.sql', import.meta.url)
const expected = renderBaseGlossarySql(data)
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== expected) throw new Error('기초 용어 migration과 검토 데이터가 다릅니다. pnpm glossary:generate로 확인해 주세요.')
  console.log(`Validated base glossary migration (${data.terms.length} terms)`)
} else {
  await writeFile(path, expected)
  console.log(`Generated ${path.pathname}`)
}
