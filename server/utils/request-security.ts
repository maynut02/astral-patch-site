import { createError, getHeader, getRequestURL, readBody, type H3Event } from 'h3'

const MAX_JSON_BODY_BYTES = 128 * 1024

function rejectRequest(statusCode: 400 | 403 | 413 | 415, statusMessage: string): never {
  throw createError({
    statusCode,
    statusMessage
  })
}

function assertRequestBodySize(event: H3Event): void {
  const contentLength = getHeader(event, 'content-length')

  if (!contentLength) {
    return
  }

  const length = Number(contentLength)

  if (!Number.isSafeInteger(length) || length < 0) {
    rejectRequest(400, 'Invalid request body length')
  }

  if (length > MAX_JSON_BODY_BYTES) {
    rejectRequest(413, 'Request body is too large')
  }
}

export function assertSameOrigin(event: H3Event): void {
  const origin = getHeader(event, 'origin')
  const referer = getHeader(event, 'referer')
  const requestOrigin = getRequestURL(event).origin
  let suppliedOrigin = origin || ''

  if (!suppliedOrigin && referer) {
    try {
      suppliedOrigin = new URL(referer).origin
    } catch {
      rejectRequest(403, 'Invalid request origin')
    }
  }

  if (suppliedOrigin === 'null' || (suppliedOrigin && suppliedOrigin !== requestOrigin)) {
    rejectRequest(403, 'Cross-origin request is not allowed')
  }
}

export async function readJsonBody<T extends Record<string, unknown>>(event: H3Event): Promise<T> {
  assertSameOrigin(event)
  assertRequestBodySize(event)

  const contentType = getHeader(event, 'content-type')?.toLowerCase() || ''

  if (!contentType.startsWith('application/json')) {
    rejectRequest(415, 'JSON request body is required')
  }

  const body = await readBody<unknown>(event, { strict: true })

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    rejectRequest(400, 'Request body must be a JSON object')
  }

  return body as T
}

export function assertMutationRequest(event: H3Event): void {
  assertSameOrigin(event)
  assertRequestBodySize(event)
}
