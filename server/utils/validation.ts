import { createError } from 'h3'

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

interface TextValidationOptions {
  field: string
  maxLength?: number
  required?: boolean
  rejectNul?: boolean
  typeMessage?: string
  emptyMessage?: string
  lengthMessage?: string
}

export function parseText(value: unknown, options: TextValidationOptions): string {
  const { field, maxLength = Infinity, required = false, rejectNul = false } = options
  if (!required && (value === undefined || value === null)) {
    return ''
  }
  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: options.typeMessage ?? `${field} ${required ? 'is required' : 'must be text'}`
    })
  }

  const normalized = value.trim()
  if (required && !normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: options.emptyMessage ?? `${field} is required`
    })
  }
  if ((rejectNul && normalized.includes('\0')) || (Number.isFinite(maxLength) && getTextLength(normalized) > maxLength)) {
    throw createError({
      statusCode: 400,
      statusMessage: options.lengthMessage ?? `${field} is too long`
    })
  }
  return normalized
}

export function parseRequiredText(value: unknown, field: string, maxLength: number): string {
  return parseText(value, { field, maxLength, required: true })
}

export function parseOptionalText(value: unknown, field: string, maxLength: number): string {
  return parseText(value, { field, maxLength })
}

// ILIKE 와일드카드를 이스케이프해 파라미터 검색 의미를 보존한다.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

export function containsLikePattern(value: string): string {
  return `%${escapeLikePattern(value)}%`
}
