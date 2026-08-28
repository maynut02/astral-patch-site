import { createError } from 'h3'

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const HANDLE_PATTERN = /^[A-Za-z0-9]{1,20}$/

export function getFirstQueryValue(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

export function parseUuid(value: unknown, statusMessage: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage
    })
  }

  return value
}

export function parsePage(value: unknown, statusMessage: string): number {
  const page = Number(getFirstQueryValue(value) || '1')

  if (!Number.isInteger(page) || page < 1 || page > 100000) {
    throw createError({
      statusCode: 400,
      statusMessage
    })
  }

  return page
}

export function getTextLength(value: string): number {
  return Array.from(value).length
}

export function parseRequiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is required`
    })
  }

  const normalized = value.trim()

  if (!normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is required`
    })
  }

  if (getTextLength(normalized) > maxLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is too long`
    })
  }

  return normalized
}

export function parseOptionalText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be text`
    })
  }

  const normalized = value.trim()

  if (getTextLength(normalized) > maxLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is too long`
    })
  }

  return normalized
}

// ILIKE 와일드카드를 이스케이프해 파라미터 검색 의미를 보존한다.
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

export function containsLikePattern(value: string): string {
  return `%${escapeLikePattern(value)}%`
}
