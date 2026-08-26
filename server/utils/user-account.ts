import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { BOT_GOOGLE_SUB, type AppRole } from './auth-user'
import { getDatabase } from './database'

export async function deleteUserAccount(googleSub: string): Promise<void> {
  const database = getDatabase()

  await database.begin(async (transaction) => {
    const [account] = await transaction<{ role: AppRole }[]>`
      SELECT "role"
      FROM app_users
      WHERE google_sub = ${googleSub}
      FOR UPDATE
    `

    if (!account) {
      throw createError({
        statusCode: 404,
        statusMessage: 'User could not be found'
      })
    }

    if (account.role === 'bot' || googleSub === BOT_GOOGLE_SUB) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Bot accounts cannot be deleted'
      })
    }

    const deletedUserId = `deleted:${randomUUID()}`

    await transaction`
      INSERT INTO app_users (
        google_sub,
        email,
        handle,
        "role"
      )
      VALUES (
        ${deletedUserId},
        ${`${deletedUserId}@system.local`},
        NULL,
        'user'
      )
    `

    await transaction`
      UPDATE translation_change_groups
      SET created_by = ${deletedUserId}
      WHERE created_by = ${googleSub}
    `
    await transaction`
      UPDATE translation_changes
      SET created_by = ${deletedUserId}
      WHERE created_by = ${googleSub}
    `
    await transaction`
      UPDATE translation_changes
      SET reviewed_by = ${deletedUserId}
      WHERE reviewed_by = ${googleSub}
    `
    await transaction`
      UPDATE translations
      SET approved_by = ${deletedUserId}
      WHERE approved_by = ${googleSub}
    `
    await transaction`
      UPDATE editor_dictionary_entries
      SET created_by = ${deletedUserId}
      WHERE created_by = ${googleSub}
    `

    const [deleted] = await transaction<{ googleSub: string }[]>`
      DELETE FROM app_users
      WHERE google_sub = ${googleSub}
      RETURNING google_sub AS "googleSub"
    `

    if (!deleted) {
      throw createError({
        statusCode: 404,
        statusMessage: 'User could not be found'
      })
    }
  })
}
