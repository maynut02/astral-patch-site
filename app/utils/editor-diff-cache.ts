import { getEditorDiffParts, type EditorDiffPart } from '~/utils/editor-diff'

export function createEditorDiffCache() {
  const cache = new WeakMap<object, { before: string, after: string, parts: EditorDiffPart[] }>()
  return (entry: { previousText?: string | null, proposedText?: string | null }): EditorDiffPart[] => {
    const before = entry.previousText ?? ''
    const after = entry.proposedText ?? ''
    const previous = cache.get(entry)
    if (previous?.before === before && previous.after === after) return previous.parts
    const parts = getEditorDiffParts(before, after)
    cache.set(entry, { before, after, parts })
    return parts
  }
}
