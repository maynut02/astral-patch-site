import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const migrationsDirectory = fileURLToPath(
  new URL('../database/migrations/', import.meta.url)
)
const migrationPattern = /^(\d{4})_[a-z0-9_]+\.sql$/
const entries = (await readdir(migrationsDirectory, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
  .map(entry => entry.name)
  .sort()

if (entries.length === 0) {
  throw new Error('No database migrations were found')
}

for (const [index, name] of entries.entries()) {
  const match = migrationPattern.exec(name)
  if (!match) {
    throw new Error(`Invalid migration filename: ${name}`)
  }

  const expectedPrefix = String(index + 1).padStart(4, '0')
  if (match[1] !== expectedPrefix) {
    throw new Error(
      `Migration sequence is incomplete: expected ${expectedPrefix}, found ${match[1]}`
    )
  }

  const contents = await readFile(`${migrationsDirectory}/${name}`, 'utf8')
  if (!contents.trim()) {
    throw new Error(`Migration is empty: ${name}`)
  }
}

console.log(`Validated ${entries.length} database migrations`)
