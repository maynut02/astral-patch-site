export type EditorDiffPartType = 'same' | 'removed' | 'added'

export interface EditorDiffPart {
  text: string
  type: EditorDiffPartType
}

function tokenize(value: string): string[] {
  return value.match(
    /\s+|[\p{Script=Han}\p{Script=Hangul}]|[\p{L}\p{N}]+|[^\p{L}\p{N}\s]/gu
  ) ?? []
}

export function getEditorDiffParts(beforeValue: string, afterValue: string): EditorDiffPart[] {
  const before = beforeValue || ''
  const after = afterValue || ''

  if (!before && !after) {
    return [{ text: '', type: 'same' }]
  }

  const beforeTokens = tokenize(before)
  const afterTokens = tokenize(after)
  const matrix = Array.from(
    { length: beforeTokens.length + 1 },
    () => Array<number>(afterTokens.length + 1).fill(0)
  )

  for (let beforeIndex = beforeTokens.length - 1; beforeIndex >= 0; beforeIndex--) {
    for (let afterIndex = afterTokens.length - 1; afterIndex >= 0; afterIndex--) {
      matrix[beforeIndex]![afterIndex] = beforeTokens[beforeIndex] === afterTokens[afterIndex]
        ? matrix[beforeIndex + 1]![afterIndex + 1]! + 1
        : Math.max(matrix[beforeIndex + 1]![afterIndex]!, matrix[beforeIndex]![afterIndex + 1]!)
    }
  }

  const parts: EditorDiffPart[] = []

  function append(text: string, type: EditorDiffPartType): void {
    if (!text) {
      return
    }

    const previous = parts.at(-1)
    if (previous?.type === type) {
      previous.text += text
      return
    }

    parts.push({ text, type })
  }

  let beforeIndex = 0
  let afterIndex = 0

  while (beforeIndex < beforeTokens.length && afterIndex < afterTokens.length) {
    if (beforeTokens[beforeIndex] === afterTokens[afterIndex]) {
      append(beforeTokens[beforeIndex]!, 'same')
      beforeIndex++
      afterIndex++
    } else if (matrix[beforeIndex + 1]![afterIndex]! >= matrix[beforeIndex]![afterIndex + 1]!) {
      append(beforeTokens[beforeIndex]!, 'removed')
      beforeIndex++
    } else {
      append(afterTokens[afterIndex]!, 'added')
      afterIndex++
    }
  }

  while (beforeIndex < beforeTokens.length) {
    append(beforeTokens[beforeIndex]!, 'removed')
    beforeIndex++
  }

  while (afterIndex < afterTokens.length) {
    append(afterTokens[afterIndex]!, 'added')
    afterIndex++
  }

  return parts
}

export function getEditorSideDiffParts(
  parts: EditorDiffPart[],
  side: 'before' | 'after'
): EditorDiffPart[] {
  const sideParts = parts.filter(part => side === 'before' ? part.type !== 'added' : part.type !== 'removed')

  return sideParts.length ? sideParts : [{ text: '', type: 'same' }]
}
