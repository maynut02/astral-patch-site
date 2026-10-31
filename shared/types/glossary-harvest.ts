export interface GlossaryHarvestSource {
  itemId: string
  sourceVersionId: string
  category: string
  unitKey: string
  jp: string
  cnS: string
  cnT: string
  ko: string
  fingerprint: string
}

export interface GlossaryHarvestCandidate {
  requestId: string
  source: GlossaryHarvestSource
  translation: string
  japanese: string
  chineseSimplified: string
  chineseTraditional: string
  note: string
  scope: 'project' | 'file'
  semanticReview: 'unrecorded' | 'recorded' | 'unresolved'
  semanticNote: string
}

export interface GlossaryHarvestResponse {
  sources: GlossaryHarvestSource[]
  categories: { category: string, total: number }[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  aiConfigured: boolean
  prompt: string
}

export interface GlossaryHarvestPreview {
  candidates: GlossaryHarvestCandidate[]
  excluded: number
}

export interface GlossaryHarvestSubmitResult {
  results: { requestId: string, status: 'submitted' | 'duplicate' | 'error', proposalId?: string, message: string }[]
}
