import { createError } from 'h3'

export function getGitHubErrorDetails(error: unknown) {
  const value = error as {
    statusCode?: number
    status?: number
    data?: { message?: unknown }
    response?: { status?: number, headers?: { get?: (name: string) => string | null } }
  } | null
  return {
    status: value?.response?.status ?? value?.statusCode ?? value?.status ?? 0,
    message: typeof value?.data?.message === 'string' ? value.data.message : '',
    remaining: value?.response?.headers?.get?.('x-ratelimit-remaining'),
    retryAfter: value?.response?.headers?.get?.('retry-after')
  }
}

// 모드의 상태별 오류 정책. 배포 피드는 기존의 단일 502 정책을 별도로 유지한다.
export function toGitHubError(error: unknown) {
  const details = getGitHubErrorDetails(error)
  if (details.status === 429 || (details.status === 403 && (
    details.remaining === '0' || details.retryAfter || /rate.?limit|abuse/i.test(details.message)
  ))) {
    return createError({
      statusCode: 429,
      statusMessage: 'GitHub API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'
    })
  }
  if (details.status === 404) {
    return createError({
      statusCode: 404,
      statusMessage: 'GitHub 저장소를 찾을 수 없거나 비공개 저장소입니다.'
    })
  }
  return createError({
    statusCode: 502,
    statusMessage: details.status === 401 || details.status === 403
      ? 'GitHub 저장소에 접근할 수 없습니다. 잠시 후 다시 시도해 주세요.'
      : 'GitHub 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
  })
}
