import type { EditorItem } from '#shared/types/editor'

const SYNTAX_TOKEN_PATTERN = /\[Astral=[^\]]+\]|<\/?[A-Za-z][^>]*>|\{[A-Za-z0-9_.:+%-]+\}|%(?:\d+\$)?[a-zA-Z]|\\[nrt]/g

function countTokens(text: string): Map<string, number> {
  const counts = new Map<string, number>()

  for (const token of text.match(SYNTAX_TOKEN_PATTERN) ?? []) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }

  return counts
}

export function getMissingTranslationSyntaxTokens(
  item: Pick<EditorItem, 'cnS' | 'en' | 'jp' | 'cnT' | 'ko'>
): string[] {
  const sourceCounts = new Map<string, number>()

  for (const source of [item.cnS, item.en, item.jp, item.cnT]) {
    for (const [token, count] of countTokens(source)) {
      sourceCounts.set(token, Math.max(sourceCounts.get(token) ?? 0, count))
    }
  }

  if (!sourceCounts.size || !item.ko.trim()) {
    return []
  }

  const translationCounts = countTokens(item.ko)
  const missing: string[] = []

  for (const [token, expectedCount] of sourceCounts) {
    const actualCount = translationCounts.get(token) ?? 0

    for (let index = actualCount; index < expectedCount; index += 1) {
      missing.push(token)
    }
  }

  return missing
}

export function getTranslationSyntaxWarning(item: Pick<EditorItem, 'cnS' | 'en' | 'jp' | 'cnT' | 'ko'>): string {
  const missing = getMissingTranslationSyntaxTokens(item)

  if (!missing.length) {
    return ''
  }

  const preview = missing.slice(0, 4).join(', ')
  const suffix = missing.length > 4 ? ` 외 ${missing.length - 4}개` : ''

  return `원문 문법 또는 플레이스홀더가 번역에서 누락되었을 수 있습니다: ${preview}${suffix}`
}
