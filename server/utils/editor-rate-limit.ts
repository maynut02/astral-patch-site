import { createError } from 'h3'
import { getDatabase } from './database'
import { isRateLimited } from './rate-limiter'

const EDITOR_MUTATION_RATE_LIMITS = [
  { name: 'minute', limit: 120, windowMs: 60_000 },
  { name: 'hour', limit: 1_000, windowMs: 3_600_000 }
] as const

const EDITOR_REVIEW_RATE_LIMITS = [
  { name: 'minute', limit: 120, windowMs: 60_000 },
  { name: 'hour', limit: 1_000, windowMs: 3_600_000 }
] as const

export async function assertEditorMutationRateLimit(userId: string, cost = 1): Promise<void> {
  if (await isRateLimited(
    getDatabase(),
    `editor-mutation:${userId}`,
    EDITOR_MUTATION_RATE_LIMITS,
    cost
  )) {
    throw createError({
      statusCode: 429,
      statusMessage: '번역 수정 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    })
  }
}

export async function assertEditorReviewRateLimit(userId: string): Promise<void> {
  if (await isRateLimited(
    getDatabase(),
    `editor-review:${userId}`,
    EDITOR_REVIEW_RATE_LIMITS
  )) {
    throw createError({
      statusCode: 429,
      statusMessage: '번역 검토 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    })
  }
}
