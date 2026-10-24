import { PARTY_HISTORY_MAX_MESSAGES, type PartyChatMessage, type PartyRoomMessage } from '#shared/types/party'

export interface LocalPartyChatMessage extends PartyChatMessage {
  delivery: 'sending' | 'failed' | 'unconfirmed'
  failureReason?: string
}

export type PartyDisplayMessage = PartyRoomMessage | LocalPartyChatMessage

export const DISPLAY_MESSAGE_CAP = PARTY_HISTORY_MAX_MESSAGES * 2

export function isLocalMessage(message: PartyDisplayMessage): message is LocalPartyChatMessage {
  return message.kind === 'chat' && 'delivery' in message
}

export function normalizeNicknameKey(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase()
}

export function mergeSessionMessages(
  existing: PartyRoomMessage[],
  incoming: PartyRoomMessage[]
): PartyRoomMessage[] {
  if (existing.length === 0) return [...incoming]
  if (incoming.length === 0) return [...existing]

  const incomingById = new Map(incoming.map(message => [message.id, message]))
  const firstIncomingId = incoming[0]?.id
  const firstOverlapIndex = firstIncomingId
    ? existing.findIndex(message => message.id === firstIncomingId)
    : -1

  const prefix = firstOverlapIndex >= 0
    ? existing.slice(0, firstOverlapIndex).filter(message => !incomingById.has(message.id))
    : existing.filter(message => !incomingById.has(message.id))

  const merged = [...prefix, ...incoming]
  const seen = new Set<string>()
  return merged.filter((message) => {
    if (seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
}
