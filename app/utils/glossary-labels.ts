import type { GlossaryDecision, GlossaryProposalStatus } from '#shared/types/editor-dictionary'

export const GLOSSARY_STATUS_NAMES: Record<GlossaryProposalStatus, string> = { pending: '제안 대기', held: '보류', approved: '확정', rejected: '반려', withdrawn: '철회' }
export const GLOSSARY_ACTION_NAMES: Record<GlossaryDecision, string> = { approve: '확정', hold: '보류', reject: '반려', resume: '검토 재개', withdraw: '철회' }
