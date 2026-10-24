import { createError } from 'h3'
import type { GitHubRelease } from './normalizers'
import { logServerError } from '../server-log'

export const GITHUB_PAGE_SIZE = 100

function getGitHubHeaders(accept: string): Record<string, string> {
  const token = String(process.env.GITHUB_TOKEN || '').trim()
  const headers: Record<string, string> = {
    'Accept': accept,
    'User-Agent': 'astral-patch-site',
    'X-GitHub-Api-Version': '2022-11-28'
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

function getGitHubErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { message: String(error) }
  }

  const value = error as {
    message?: unknown
    status?: unknown
    statusCode?: unknown
    statusMessage?: unknown
    response?: {
      status?: unknown
      statusText?: unknown
      headers?: { get?: (name: string) => string | null }
    }
  }
  const headers = value.response?.headers

  return {
    message: typeof value.message === 'string' ? value.message : undefined,
    status: typeof value.response?.status === 'number'
      ? value.response.status
      : typeof value.statusCode === 'number'
        ? value.statusCode
        : typeof value.status === 'number'
          ? value.status
          : undefined,
    statusText: typeof value.response?.statusText === 'string'
      ? value.response.statusText
      : typeof value.statusMessage === 'string'
        ? value.statusMessage
        : undefined,
    rateLimitRemaining: headers?.get?.('x-ratelimit-remaining') ?? undefined,
    rateLimitReset: headers?.get?.('x-ratelimit-reset') ?? undefined
  }
}

export async function fetchReleasePage(repository: string, page: number): Promise<GitHubRelease[]> {
  try {
    return await $fetch<GitHubRelease[]>(`https://api.github.com/repos/${repository}/releases`, {
      query: {
        per_page: GITHUB_PAGE_SIZE,
        page
      },
      headers: getGitHubHeaders('application/vnd.github+json'),
      retry: 1,
      timeout: 10_000
    })
  } catch (error) {
    logServerError('github-releases', 'GitHub releases request failed', {
      repository,
      page,
      ...getGitHubErrorDetails(error)
    })

    throw createError({
      statusCode: 502,
      statusMessage: 'GitHub release information could not be loaded'
    })
  }
}

export async function fetchDistributionJson(repository: string, filename: string): Promise<unknown | null> {
  try {
    return await $fetch(`https://api.github.com/repos/${repository}/contents/${filename}`, {
      query: {
        ref: 'distribution'
      },
      headers: getGitHubHeaders('application/vnd.github.raw+json'),
      retry: 1,
      timeout: 10_000
    })
  } catch (error) {
    console.warn('[github-releases] GitHub distribution file request failed', {
      repository,
      filename,
      ...getGitHubErrorDetails(error)
    })

    return null
  }
}
