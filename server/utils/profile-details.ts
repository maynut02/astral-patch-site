import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import {
  GAME_PROFILE_VALUE_MAX_LENGTH,
  HANDLE_PATTERN,
  SOCIAL_LINK_LABEL_MAX_LENGTH,
  SOCIAL_LINK_MAX_COUNT,
  SOCIAL_LINK_URL_MAX_LENGTH,
  type EditableUserProfile,
  type UserSocialLink
} from '#shared/types/profile'
import type { UserRole } from '#shared/types/user'
import { getTextLength, parseText } from './validation'
import { getDatabase, type DatabaseClient } from './database'

interface ProfileRow {
  googleSub: string
  email: string
  handle: string | null
  role: UserRole
  gameUid: string | null
  gameInviteCode: string | null
}

interface SocialLinkRow {
  id: string
  label: string
  url: string
}

export interface SavedUserProfile extends EditableUserProfile {
  googleSub: string
  email: string
  role: UserRole
}

export type UserProfileUpdateInput = Record<string, unknown> & {
  handle?: unknown
  gameUid?: unknown
  gameInviteCode?: unknown
  socialLinks?: unknown
}

function parseHandle(value: unknown): string {
  const handle = parseText(value, {
    field: 'Handle',
    required: true,
    emptyMessage: 'Handle may contain only letters and numbers'
  })

  if (!HANDLE_PATTERN.test(handle)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Handle may contain only letters and numbers'
    })
  }

  return handle
}

function parseOptionalGameValue(
  value: unknown,
  field: string,
  pattern: RegExp,
  invalidMessage: string
): string | null {
  const normalized = parseText(value, { field })

  if (!normalized) {
    return null
  }

  if (!pattern.test(normalized)) {
    throw createError({ statusCode: 400, statusMessage: invalidMessage })
  }

  if (getTextLength(normalized) > GAME_PROFILE_VALUE_MAX_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `${field} is too long` })
  }

  return normalized
}

function parseSocialLinks(value: unknown): Omit<UserSocialLink, 'id'>[] {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Social links must be an array' })
  }

  if (value.length > SOCIAL_LINK_MAX_COUNT) {
    throw createError({ statusCode: 400, statusMessage: `Up to ${SOCIAL_LINK_MAX_COUNT} social links are allowed` })
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw createError({ statusCode: 400, statusMessage: `Social link ${index + 1} is invalid` })
    }

    const candidate = entry as { label?: unknown, url?: unknown }
    const labelMessage = `Social link ${index + 1} label is invalid`
    const urlMessage = `Social link ${index + 1} URL is invalid`
    const label = parseText(candidate.label, {
      field: 'Social link label',
      required: true,
      maxLength: SOCIAL_LINK_LABEL_MAX_LENGTH,
      typeMessage: labelMessage,
      emptyMessage: labelMessage,
      lengthMessage: labelMessage
    })
    const url = parseText(candidate.url, {
      field: 'Social link URL',
      required: true,
      maxLength: SOCIAL_LINK_URL_MAX_LENGTH,
      typeMessage: urlMessage,
      emptyMessage: urlMessage,
      lengthMessage: urlMessage
    })

    let parsedUrl: URL

    try {
      parsedUrl = new URL(url)
    } catch {
      throw createError({ statusCode: 400, statusMessage: `Social link ${index + 1} URL is invalid` })
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw createError({ statusCode: 400, statusMessage: `Social link ${index + 1} URL must use HTTP or HTTPS` })
    }

    return { label, url: parsedUrl.toString() }
  })
}

export async function listSocialLinks(database: DatabaseClient, googleSub: string): Promise<UserSocialLink[]> {
  return database<SocialLinkRow[]>`
    SELECT id, label, url
    FROM app_user_social_links
    WHERE user_id = ${googleSub}
    ORDER BY sort_order ASC, created_at ASC
  `
}

export async function getUserProfileDetails(googleSub: string): Promise<SavedUserProfile> {
  const database = getDatabase()
  const [user] = await database<ProfileRow[]>`
    SELECT
      google_sub AS "googleSub",
      email,
      handle,
      "role" AS role,
      game_uid AS "gameUid",
      game_invite_code AS "gameInviteCode"
    FROM app_users
    WHERE google_sub = ${googleSub}
  `

  if (!user || !user.handle) {
    throw createError({ statusCode: 404, statusMessage: 'User could not be found' })
  }

  const socialLinks = await listSocialLinks(database, googleSub)

  return {
    googleSub: user.googleSub,
    email: user.email,
    handle: user.handle,
    role: user.role,
    gameUid: user.gameUid,
    gameInviteCode: user.gameInviteCode,
    socialLinks
  }
}

export async function saveUserProfileDetails(
  googleSub: string,
  input: UserProfileUpdateInput
): Promise<SavedUserProfile> {
  const handle = parseHandle(input.handle)
  const gameUid = parseOptionalGameValue(
    input.gameUid,
    'Game UID',
    /^[0-9]+$/,
    'Game UID may contain only numbers'
  )
  const gameInviteCode = parseOptionalGameValue(
    input.gameInviteCode,
    'Game invite code',
    /^[A-Za-z0-9]+$/,
    'Game invite code may contain only letters and numbers'
  )
  const socialLinks = parseSocialLinks(input.socialLinks)
  const database = getDatabase()

  try {
    return await database.begin(async (transaction) => {
      const [user] = await transaction<ProfileRow[]>`
        UPDATE app_users
        SET
          handle = ${handle},
          game_uid = ${gameUid},
          game_invite_code = ${gameInviteCode},
          updated_at = now()
        WHERE google_sub = ${googleSub}
        RETURNING
          google_sub AS "googleSub",
          email,
          handle,
          "role" AS role,
          game_uid AS "gameUid",
          game_invite_code AS "gameInviteCode"
      `

      if (!user || !user.handle) {
        throw createError({ statusCode: 404, statusMessage: 'User could not be found' })
      }

      await transaction`
        DELETE FROM app_user_social_links
        WHERE user_id = ${googleSub}
      `

      const savedSocialLinks = socialLinks.length === 0
        ? []
        : await transaction<SocialLinkRow[]>`
        WITH inserted AS (
          INSERT INTO app_user_social_links (id, user_id, label, url, sort_order)
          SELECT link.id::uuid, ${googleSub}, link.label, link.url, link.ordinality::int - 1
          FROM unnest(
            ${transaction.array(socialLinks.map(() => randomUUID()))}::text[],
            ${transaction.array(socialLinks.map(link => link.label))}::text[],
            ${transaction.array(socialLinks.map(link => link.url))}::text[]
          ) WITH ORDINALITY AS link(id, label, url, ordinality)
          RETURNING id, label, url, sort_order
        )
        SELECT id, label, url FROM inserted ORDER BY sort_order ASC
      `

      return {
        googleSub: user.googleSub,
        email: user.email,
        handle: user.handle,
        role: user.role,
        gameUid: user.gameUid,
        gameInviteCode: user.gameInviteCode,
        socialLinks: savedSocialLinks
      }
    })
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'Handle is already in use' })
    }

    throw error
  }
}
