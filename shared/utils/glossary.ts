import type { GlossaryMetadata, GlossaryDecision, GlossaryProposalStatus } from '../types/editor-dictionary.ts'

export function emptyGlossaryMetadata(): GlossaryMetadata {
  return {
    archived: false, kind: 'term', japanese: '', chineseSimplified: '', chineseTraditional: '',
    allowed: [], historical: [], discouraged: [], scope: 'project', target: '',
    semanticReview: 'unrecorded', semanticNote: '', evidenceKey: '', speechStyle: '',
    selfAddress: '', otherAddress: '', endings: '', exceptions: '', exampleSource: '', exampleTranslation: ''
  }
}

export function glossarySourceMatches(metadata: GlossaryMetadata, source: { jp: string, cnS: string, cnT: string, category: string, unitKey: string }): boolean {
  if (metadata.archived || metadata.kind !== 'term' || metadata.scope === 'character') return false
  if (metadata.scope === 'file' && metadata.target !== source.category) return false
  if (metadata.scope === 'entry' && metadata.target !== `${source.category}_${source.unitKey}`) return false
  const textOnly = (text: string) => text.replace(/<[^>]*>|\[[^\]]*\]|\{[^}]*\}/g, ' ').normalize('NFC')
  return ([['japanese', 'jp'], ['chineseSimplified', 'cnS'], ['chineseTraditional', 'cnT']] as const)
    .some(([term, language]) => metadata[term] !== '' && textOnly(source[language]).includes(metadata[term].normalize('NFC')))
}

export function glossaryNextStatus(status: GlossaryProposalStatus, action: GlossaryDecision): GlossaryProposalStatus | null {
  if (status === 'pending') return { approve: 'approved', hold: 'held', reject: 'rejected', resume: null, withdraw: 'withdrawn' }[action] as GlossaryProposalStatus | null
  if (status === 'held' && action === 'resume') return 'pending'
  if (status === 'held' && action === 'withdraw') return 'withdrawn'
  return null
}
