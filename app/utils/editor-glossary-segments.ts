import type { EditorDictionaryEntry } from '#shared/types/editor-dictionary'
import type { EditorLanguage } from '#shared/types/editor'

export type GlossarySourceSegment
  = | { type: 'text', content: string }
    | { type: 'term', content: string, entries: EditorDictionaryEntry[] }

interface Match {
  start: number
  end: number
  entry: EditorDictionaryEntry
}

function splitText(text: string, entries: readonly EditorDictionaryEntry[], language: EditorLanguage): GlossarySourceSegment[] {
  const field = language === 'jp' ? 'japanese' : language === 'cnS' ? 'chineseSimplified' : language === 'cnT' ? 'chineseTraditional' : null
  if (!field || !text || !entries.length) return [{ type: 'text', content: text }]
  let normalized = ''
  const starts = new Map<number, number>()
  const ends = new Map<number, number>()
  // 정규화한 위치를 원래 글자 묶음에 대응시켜 결합 문자·이모지를 나누거나 원문을 바꾸지 않는다.
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    starts.set(normalized.length, part.index)
    normalized += part.segment.normalize('NFC')
    ends.set(normalized.length, part.index + part.segment.length)
  }
  const matches: Match[] = []
  for (const entry of entries) {
    if (entry.metadata.kind !== 'term' || entry.metadata.archived) continue
    const term = entry.metadata[field].normalize('NFC')
    if (!term) continue
    let cursor = 0
    let index: number
    while ((index = normalized.indexOf(term, cursor)) !== -1) {
      const start = starts.get(index)
      const end = ends.get(index + term.length)
      if (start !== undefined && end !== undefined) matches.push({ start, end, entry })
      cursor = index + 1
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  const result: GlossarySourceSegment[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start < cursor) {
      const previous = result[result.length - 1]
      if (match.end === cursor && previous?.type === 'term' && match.start === cursor - previous.content.length && !previous.entries.some(entry => entry.id === match.entry.id)) previous.entries.push(match.entry)
      continue
    }
    if (match.start > cursor) result.push({ type: 'text', content: text.slice(cursor, match.start) })
    result.push({ type: 'term', content: text.slice(match.start, match.end), entries: [match.entry] })
    cursor = match.end
  }
  if (cursor < text.length) result.push({ type: 'text', content: text.slice(cursor) })
  return result
}

export function getGlossarySourceSegments(text: string, entries: readonly EditorDictionaryEntry[], language: EditorLanguage): GlossarySourceSegment[] {
  const protectedText = /<[^>]*>|\[[^\]]*\]|\{[^}]*\}/g
  const result: GlossarySourceSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(protectedText)) {
    if (match.index > cursor) result.push(...splitText(text.slice(cursor, match.index), entries, language))
    result.push({ type: 'text', content: match[0] })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) result.push(...splitText(text.slice(cursor), entries, language))
  return result
}
