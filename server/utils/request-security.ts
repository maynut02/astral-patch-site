import { createError, getHeader, getRequestURL, readBody, type H3Event } from 'h3'

const MAX_JSON_BODY_BYTES = 128 * 1024

const REQUEST_ERROR_CODE = Symbol.for('astral-patch-site.request-error-code')

export function getRequestErrorCode(error: object): string | undefined {
  const code = (error as Record<symbol, unknown>)[REQUEST_ERROR_CODE]
  return typeof code === 'string' ? code : undefined
}

function rejectRequest(statusCode: 400 | 403 | 413 | 415, statusMessage: string, code: string): never {
  const error = createError({ statusCode, statusMessage })
  // 오류 응답 JSON은 바꾸지 않고 서버 내부 매핑에만 안정적인 코드를 사용한다.
  Object.defineProperty(error, REQUEST_ERROR_CODE, { value: code })
  throw error
}

function assertRequestBodySize(event: H3Event): void {
  const contentLength = getHeader(event, 'content-length')

  if (!contentLength) {
    return
  }

  const length = Number(contentLength)

  if (!Number.isSafeInteger(length) || length < 0) {
    rejectRequest(400, 'Invalid request body length', 'INVALID_BODY_LENGTH')
  }

  if (length > MAX_JSON_BODY_BYTES) {
    rejectRequest(413, 'Request body is too large', 'BODY_TOO_LARGE')
  }
}

export function assertSameOrigin(event: H3Event): void {
  const origin = getHeader(event, 'origin')
  const referer = getHeader(event, 'referer')
  const fetchSite = getHeader(event, 'sec-fetch-site')?.toLowerCase()
  const requestOrigin = getRequestURL(event).origin
  let suppliedOrigin = origin || ''

  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    rejectRequest(403, 'Cross-origin request is not allowed', 'CROSS_ORIGIN')
  }

  if (!suppliedOrigin && referer) {
    try {
      suppliedOrigin = new URL(referer).origin
    } catch {
      rejectRequest(403, 'Invalid request origin', 'INVALID_ORIGIN')
    }
  }

  if (suppliedOrigin === 'null' || (suppliedOrigin && suppliedOrigin !== requestOrigin)) {
    rejectRequest(403, 'Cross-origin request is not allowed', 'CROSS_ORIGIN')
  }
}

// 객체 여부만 보장하며 각 필드의 검증은 도메인 파서가 담당한다.
export async function readJsonBody(event: H3Event): Promise<Record<string, unknown>> {
  assertSameOrigin(event)
  assertRequestBodySize(event)

  const contentType = getHeader(event, 'content-type')?.toLowerCase() || ''

  if (!contentType.startsWith('application/json')) {
    rejectRequest(415, 'JSON request body is required', 'JSON_REQUIRED')
  }

  const body = await readBody<unknown>(event, { strict: true })

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    rejectRequest(400, 'Request body must be a JSON object', 'OBJECT_REQUIRED')
  }

  return body as Record<string, unknown>
}

export function assertMutationRequest(event: H3Event): void {
  assertSameOrigin(event)
  assertRequestBodySize(event)
}
