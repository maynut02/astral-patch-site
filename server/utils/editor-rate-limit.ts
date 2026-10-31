import { createError } from 'h3'
import { getDatabase } from './database'
import { isRateLimited } from './rate-limiter'

const EDITOR_WRITE_RATE_LIMITS = [
  { name: 'minute', limit: 120, windowMs: 60_000 },
  { name: 'hour', limit: 1_000, windowMs: 3_600_000 }
] as const

const EDITOR_COMMENT_RATE_LIMITS = [
  { name: 'minute', limit: 30, windowMs: 60_000 },
  { name: 'hour', limit: 300, windowMs: 3_600_000 }
] as const

export async function assertEditorMutationRateLimit(userId: string, cost = 1): Promise<void> {
  if (await isRateLimited(
    getDatabase(),
    `editor-mutation:${userId}`,
    EDITOR_WRITE_RATE_LIMITS,
    cost
  )) {
    throw createError({
      statusCode: 429,
      statusMessage: '번역 수정 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    })
  }
}

export async function assertEditorReviewRateLimit(userId: string, cost = 1): Promise<void> {
  if (await isRateLimited(
    getDatabase(),
    `editor-review:${userId}`,
    EDITOR_WRITE_RATE_LIMITS,
    cost
  )) {
    throw createError({
      statusCode: 429,
      statusMessage: '번역 검토 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    })
  }
}

export async function assertEditorCommentRateLimit(userId: string): Promise<void> {
  if (await isRateLimited(
    getDatabase(),
    `editor-comment:${userId}`,
    EDITOR_COMMENT_RATE_LIMITS
  )) {
    throw createError({
      statusCode: 429,
      statusMessage: '코멘트 작성 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    })
  }
}

const EDITOR_AI_RATE_LIMITS = [
  { name: 'minute', limit: 10, windowMs: 60_000 },
  { name: 'hour', limit: 100, windowMs: 3_600_000 }
] as const

export async function assertEditorAiTranslationRateLimit(user: { id: string, role: string }): Promise<void> {
  if (user.role !== 'admin' && await isRateLimited(
    getDatabase(),
    `editor-ai-translation:${user.id}`,
    EDITOR_AI_RATE_LIMITS
  )) {
    throw createError({
      statusCode: 429,
      statusMessage: 'AI 번역 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    })
  }
}

export async function assertGlossaryAiRateLimit(userId: string): Promise<void> {
  if (await isRateLimited(getDatabase(), `glossary-ai:${userId}`, [
    { name: 'minute', limit: 3, windowMs: 60_000 },
    { name: 'hour', limit: 30, windowMs: 3_600_000 }
  ])) throw createError({ statusCode: 429, statusMessage: '용어 추출 요청이 많습니다. 잠시 후 다시 시도해 주세요.' })
}
