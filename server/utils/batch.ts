import { createError } from 'h3'

export function requireBatchItems(value: unknown, maximum: number, statusMessage: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw createError({ statusCode: 400, statusMessage })
  }
  return value
}

export function assertUniqueBatch(ids: readonly string[], statusMessage: string): void {
  if (new Set(ids).size !== ids.length) {
    throw createError({ statusCode: 400, statusMessage })
  }
}

// 단건 트랜잭션과 알림 순서를 유지하고 부분 실패만 결과로 변환한다.
export async function runSequentialBatch<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
  onError: (error: unknown, item: T) => R
): Promise<R[]> {
  const results: R[] = []
  for (const item of items) {
    try {
      results.push(await worker(item))
    } catch (error: unknown) {
      results.push(onError(error, item))
    }
  }
  return results
}
