import { PARTY_CHARACTER_IDS, PARTY_ORDERS, PARTY_SPECTATOR_ID, PARTY_UNSELECTED_ID, type PartyClientMessage, type PartyErrorServerMessage, type PartyParticipant, type PartyRoomMessage, type PartyServerMessage } from '#shared/types/party'

export function encodePartyClientMessage(message: PartyClientMessage): string {
  return JSON.stringify(message)
}

function isParticipant(value: unknown): value is PartyParticipant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const participant = value as Partial<PartyParticipant>
  return typeof participant.id === 'string'
    && typeof participant.nickname === 'string'
    && (participant.characterId === PARTY_SPECTATOR_ID || participant.characterId === PARTY_UNSELECTED_ID || PARTY_CHARACTER_IDS.some(id => id === participant.characterId))
    && (participant.order === null || PARTY_ORDERS.some(order => order === participant.order))
}

function isRoomMessage(value: unknown): value is PartyRoomMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as Partial<PartyRoomMessage>
  if (typeof message.id !== 'string' || typeof message.createdAt !== 'string') return false
  if (message.kind === 'join' || message.kind === 'leave') return typeof message.nickname === 'string'
  return message.kind === 'chat' && typeof message.clientMessageId === 'string' && typeof message.text === 'string' && isParticipant(message.participant)
}

export function isPartyServerMessage(value: unknown): value is PartyServerMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as Partial<PartyServerMessage>
  switch (message.type) {
    case 'JOINED':
      return typeof message.sessionId === 'string'
        && typeof message.participantId === 'string'
        && typeof message.reconnectToken === 'string'
        && Boolean(message.room && typeof message.room === 'object'
          && typeof message.room.roomId === 'string'
          && typeof message.room.participantCount === 'number'
          && typeof message.room.createdAt === 'string')
        && Array.isArray(message.messages) && message.messages.every(isRoomMessage)
        && Array.isArray(message.participants) && message.participants.every(isParticipant)
    case 'CHAT':
      return isRoomMessage(message.message) && message.message.kind === 'chat'
    case 'JOIN_NOTICE':
      return isRoomMessage(message.notice) && message.notice.kind === 'join'
    case 'LEAVE_NOTICE':
      return isRoomMessage(message.notice) && message.notice.kind === 'leave'
    case 'PARTICIPANTS':
      return Array.isArray(message.participants) && message.participants.every(isParticipant)
    case 'HISTORY':
      return typeof message.before === 'string' && typeof message.hasMore === 'boolean'
        && Array.isArray(message.messages) && message.messages.every(isRoomMessage)
    case 'ERROR':
      return typeof message.code === 'string' && typeof message.message === 'string'
        && (message.clientMessageId === undefined || typeof message.clientMessageId === 'string')
        && (message.retryAfterMs === undefined || typeof message.retryAfterMs === 'number')
    case 'PONG':
      return true
    default:
      return false
  }
}

export function readPartyRetryAfterMs(message: PartyErrorServerMessage): number | undefined {
  const value = message.retryAfterMs
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export const PARTY_FATAL_JOIN_ERROR_CODES = new Set([
  'INVALID_ROOM_ID',
  'INVALID_NICKNAME',
  'INVALID_CHARACTER',
  'INVALID_ORDER',
  'SPECTATOR_ORDER_DISABLED',
  'ROOM_NOT_FOUND',
  'NICKNAME_TAKEN'
])
// 서버가 재시도를 허용하는 오류는 입장 상태를 유지한 채 백오프로 다시 시도한다.
export const PARTY_RETRYABLE_JOIN_ERROR_CODES = new Set([
  'JOIN_RATE_LIMITED',
  'STORAGE_UNAVAILABLE',
  'CONNECTION_CLOSED'
])
