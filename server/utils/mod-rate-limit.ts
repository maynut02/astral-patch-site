import { createError } from 'h3'
import { getDatabase } from './database'
import { isRateLimited } from './rate-limiter'

const MOD_MUTATION_RATE_LIMITS = [
  { name: 'minute', limit: 10, windowMs: 60_000 },
  { name: 'hour', limit: 60, windowMs: 3_600_000 }
] as const

export async function assertModMutationRateLimit(userId: string): Promise<void> {
  if (await isRateLimited(getDatabase(), `mod-mutation:${userId}`, MOD_MUTATION_RATE_LIMITS)) {
    throw createError({ statusCode: 429, statusMessage: '모드 변경 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' })
  }
}
