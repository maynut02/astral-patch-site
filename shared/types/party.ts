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
export const PARTY_MAX_NICKNAME_LENGTH = 20
export const PARTY_MAX_TEXT_LENGTH = 1_000

export function getPartyTextLength(value: string): number {
  return Array.from(value).length
}

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

// 명시적 퇴장: 즉시 퇴장 알림을 남긴다.
export const PARTY_CLOSE_LEAVE = { code: 1000, reason: 'leave-room' } as const
// 창 닫기·새로고침(pagehide): 새로고침 복귀를 기다리는 짧은 유예 뒤 퇴장 알림을 남긴다.
export const PARTY_CLOSE_PAGE_HIDE = { code: 4001, reason: 'page-hide' } as const
// 클라이언트가 응답 없는 소켓을 포기할 때(heartbeat, JOINED 기한, 화면 복귀 확인). 서버는 일반 단절로 유예한다.
// reason은 `heartbeat-timeout`, `join-timeout`, `liveness-timeout` 중 하나다.
export const PARTY_CLOSE_UNRESPONSIVE_CODE = 4002

// 재연결 JOIN에 싣는 직전 연결의 종료 정보. 서버는 연결 로그에만 사용한다.
export interface PartyConnectionDiagnostics {
  // 마지막 JOINED 이후 이번 JOIN까지의 연속 연결 시도 횟수
  attempt?: number
  lastCloseCode?: number
  lastCloseReason?: string
  // 직전 소켓이 닫힌 뒤 이번 JOIN까지 지난 시간(ms)
  lastCloseAgoMs?: number
  hiddenAtClose?: boolean
  onlineAtClose?: boolean
  // 페이지의 첫 JOIN에서만 PerformanceNavigationTiming.type을 보낸다.
  navigationType?: string
}

export interface PartyJoinClientMessage {
  type: 'JOIN'
  roomId: string
  nickname: string
  characterId: PartyCharacterId
  order: PartyOrder | null
  reconnectToken?: string
  diagnostics?: PartyConnectionDiagnostics
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
  reconnectToken: string
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
  // 서버가 재시도 가능 시점까지 남은 시간(ms)을 알려줄 때만 존재한다.
  // 없음은 재시도 가능을 뜻하지 않는다(예: 라이브 닉네임 충돌은 종료 상태).
  retryAfterMs?: number
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
