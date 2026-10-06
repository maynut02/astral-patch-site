// Keep the catalogue explicit until the game provides a character data source.
export const PARTY_CHARACTER_IDS = [
  '101', '102', '103', '104', '105', '106', '107', '108', '109',
  '110', '111', '112', '113', '114', '115', '116', '117', '118', '119',
  '120', '121', '122', '123', '124', '125', '126', '127', '128', '129',
  '301', '302', '303', '304', '305', '306'
] as const

export const PARTY_SPECTATOR_ID = 'spectator' as const
export const PARTY_UNSELECTED_ID = 'unselected' as const
export const PARTY_ORDERS = ['P1', 'P2', 'P3', 'P4'] as const

export type PartyGameCharacterId = typeof PARTY_CHARACTER_IDS[number]
export type PartyCharacterId = PartyGameCharacterId | typeof PARTY_SPECTATOR_ID | typeof PARTY_UNSELECTED_ID
export type PartyOrder = typeof PARTY_ORDERS[number]

export interface PartyCharacter {
  id: PartyGameCharacterId
  name: string
  nickname: string
  image: string
}

export function getPartyCharacterImage(id: PartyCharacterId): string {
  return id === PARTY_SPECTATOR_ID || id === PARTY_UNSELECTED_ID
    ? ''
    : `https://file.maynutlab.com/character/UT_Item_Hero_${id}.png`
}

export const PARTY_ROOM_ID_PATTERN = /^[0-9]{6}$/
export const PARTY_HISTORY_MAX_MESSAGES = 300
export const PARTY_HISTORY_MAX_BYTES = 256 * 1024

export interface PartyRoomSummary {
  roomId: string
  participantCount: number
  createdAt: string
}

export interface PartyParticipant {
  id: string
  nickname: string
  characterId: PartyCharacterId
  order: PartyOrder | null
}

export interface PartyChatMessage {
  kind: 'chat'
  id: string
  clientMessageId: string
  participant: PartyParticipant
  text: string
  createdAt: string
}

export interface PartyJoinNotice {
  kind: 'join'
  id: string
  nickname: string
  createdAt: string
}

export interface PartyLeaveNotice {
  kind: 'leave'
  id: string
  nickname: string
  createdAt: string
}

export type PartyRoomMessage = PartyChatMessage | PartyJoinNotice | PartyLeaveNotice

export interface PartyJoinClientMessage {
  type: 'JOIN'
  roomId: string
  nickname: string
  characterId: PartyCharacterId
  order: PartyOrder | null
}

export interface PartyChatClientMessage {
  type: 'CHAT'
  text: string
  clientMessageId?: string
}

export interface PartySetCharacterClientMessage {
  type: 'SET_CHARACTER'
  characterId: PartyCharacterId
}

export interface PartySetOrderClientMessage {
  type: 'SET_ORDER'
  order: PartyOrder
}

export interface PartyPingClientMessage {
  type: 'PING'
}

export interface PartyHistoryClientMessage {
  type: 'HISTORY'
  before: string
}

export type PartyClientMessage
  = PartyJoinClientMessage
    | PartyChatClientMessage
    | PartySetCharacterClientMessage
    | PartySetOrderClientMessage
    | PartyPingClientMessage
    | PartyHistoryClientMessage

export interface PartyJoinedServerMessage {
  type: 'JOINED'
  sessionId: string
  participantId: string
  room: PartyRoomSummary
  messages: PartyRoomMessage[]
  participants: PartyParticipant[]
}

export interface PartyChatServerMessage {
  type: 'CHAT'
  message: PartyChatMessage
}

export interface PartyJoinNoticeServerMessage {
  type: 'JOIN_NOTICE'
  notice: PartyJoinNotice
}

export interface PartyLeaveNoticeServerMessage {
  type: 'LEAVE_NOTICE'
  notice: PartyLeaveNotice
}

export interface PartyParticipantsServerMessage {
  type: 'PARTICIPANTS'
  participants: PartyParticipant[]
}

export interface PartyErrorServerMessage {
  type: 'ERROR'
  code: string
  message: string
  clientMessageId?: string
}

export interface PartyPongServerMessage {
  type: 'PONG'
}

export interface PartyHistoryServerMessage {
  type: 'HISTORY'
  before: string
  messages: PartyRoomMessage[]
  hasMore: boolean
}

export type PartyServerMessage
  = PartyJoinedServerMessage
    | PartyChatServerMessage
    | PartyJoinNoticeServerMessage
    | PartyLeaveNoticeServerMessage
    | PartyParticipantsServerMessage
    | PartyErrorServerMessage
    | PartyPongServerMessage
    | PartyHistoryServerMessage
