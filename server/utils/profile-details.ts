import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { EditableUserProfile, UserSocialLink } from '#shared/types/profile'
import { HANDLE_PATTERN, getTextLength } from './validation'
import { getDatabase } from './database'
import type { AppRole } from './auth-user'

const GAME_VALUE_MAX_LENGTH = 64
const SOCIAL_LINK_LABEL_MAX_LENGTH = 30
const SOCIAL_LINK_URL_MAX_LENGTH = 500
const SOCIAL_LINK_MAX_COUNT = 10

interface ProfileRow {
  googleSub: string
  email: string
  handle: string | null
  role: AppRole
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
  role: AppRole
}

export type UserProfileUpdateInput = Record<string, unknown> & {
  handle?: unknown
  gameUid?: unknown
  gameInviteCode?: unknown
  socialLinks?: unknown
}

function parseHandle(value: unknown): string {
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Handle is required' })
  }

  const handle = value.trim()

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
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be text` })
  }

  const normalized = value.trim()

  if (!normalized) {
    return null
  }

  if (!pattern.test(normalized)) {
    throw createError({ statusCode: 400, statusMessage: invalidMessage })
  }

  if (getTextLength(normalized) > GAME_VALUE_MAX_LENGTH) {
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
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''

    if (!label || getTextLength(label) > SOCIAL_LINK_LABEL_MAX_LENGTH) {
      throw createError({ statusCode: 400, statusMessage: `Social link ${index + 1} label is invalid` })
    }

    if (!url || getTextLength(url) > SOCIAL_LINK_URL_MAX_LENGTH) {
      throw createError({ statusCode: 400, statusMessage: `Social link ${index + 1} URL is invalid` })
    }

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

  const socialLinks = await database<SocialLinkRow[]>`
    SELECT id, label, url
    FROM app_user_social_links
    WHERE user_id = ${googleSub}
    ORDER BY sort_order ASC, created_at ASC
  `

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

      const savedSocialLinks: UserSocialLink[] = []

      for (const [index, link] of socialLinks.entries()) {
        const id = randomUUID()
        const [savedLink] = await transaction<SocialLinkRow[]>`
          INSERT INTO app_user_social_links (
            id,
            user_id,
            label,
            url,
            sort_order
          )
          VALUES (
            ${id},
            ${googleSub},
            ${link.label},
            ${link.url},
            ${index}
          )
          RETURNING id, label, url
        `

        if (savedLink) {
          savedSocialLinks.push(savedLink)
        }
      }

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
