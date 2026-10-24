import type { PartyChatMessage, PartyLeaveNotice, PartyParticipant, PartyRoomMessage, PartyRoomSummary } from '../../shared/types/party.ts'

export interface PartyPeer {
  id: string
  request?: Request
  remoteAddress?: string
  bufferedAmount?: number
  websocket?: {
    bufferedAmount?: number
    ping?: (payload?: string) => void
    on?: (event: 'pong', listener: () => void) => unknown
  }
  send: (payload: string) => unknown
  ping?: (payload?: string) => unknown
  close: (code?: number, reason?: string) => unknown
}

export interface PartyConnection {
  peer: PartyPeer
  ipAddress: string
  lastSeenAt: number
  messageWindowStartedAt: number
  messageCount: number
  closed: boolean
  joining: boolean
  suppressJoinNotice: boolean
  // 같은 참가자 ID를 다른 소켓이 인계받았는지 여부. 인계 뒤의 낡은 작업은 적용하지 않는다.
  replacedByTakeover: boolean
  room?: PartyRoom
  participant?: PartyParticipant & { reconnectTokenHash: string }
}

// 연결이 끊긴 참가자의 닉네임·토큰 예약. 실시간 맵과 분리해 보관한다.
export interface PendingDeparture {
  participant: PartyParticipant
  reconnectTokenHash: string
  departure: 'page-hide' | 'loss' | 'restored'
  restored: boolean
  disconnectedAt: number
  expiresAt: number
  generation: number
  timer?: ReturnType<typeof setTimeout>
}

export interface PartyRoom {
  roomId: string
  sessionId: string
  createdAt: string
  participants: Map<PartyPeer, PartyConnection>
  // 유예 예약은 실시간 참가자 맵과 별도로 participantId 기준으로만 보관한다.
  pendingDepartures: Map<string, PendingDeparture>
  departureGeneration: number
  clientMessages: Map<string, PartyChatMessage>
  messages: PartyRoomMessage[]
  messageIds: Set<string>
  messageSizes: number[]
  historyBytes: number
  emptySinceMs: number | null
  writeQueue: Promise<void>
}

export interface JoinAttemptState {
  count: number
  windowStartedAt: number
}

export interface PartyPresenceUpdate {
  roomId: string
  // 생략하면 참가자 목록은 다시 보내지 않고 공지와 같은 update만 전송한다.
  participants?: PartyParticipant[]
  notice?: PartyLeaveNotice
}

export interface PartyCreateSuccess {
  ok: true
  room: PartyRoomSummary
}

export interface PartyCreateFailure {
  ok: false
  code: 'INVALID_ROOM_ID' | 'ROOM_LIMIT'
  message: string
}

export type PartyCreateResult = PartyCreateSuccess | PartyCreateFailure

export interface PartyJoinInput {
  roomId: unknown
  nickname: unknown
  characterId: unknown
  order?: unknown
  reconnectToken?: unknown
  diagnostics?: unknown
}

export interface PartyJoinSuccess {
  ok: true
  sessionId: string
  participantId: string
  reconnectToken: string
  resumed: boolean
  room: PartyRoomSummary
  messages: PartyRoomMessage[]
  participants: PartyParticipant[]
}

export interface PartyJoinFailure {
  ok: false
  code: string
  message: string
  // 서버가 재시도 가능 시점까지 남은 시간(ms)을 알려줄 때만 채운다.
  // 없음은 재시도 가능을 뜻하지 않으며, 라이브 닉네임 충돌처럼 종료 상태인 경우도 있다.
  retryAfterMs?: number
}

export type PartyJoinResult = PartyJoinSuccess | PartyJoinFailure

export interface PartyCharacterChangeSuccess {
  ok: true
  roomId: string
  participants: PartyParticipant[]
}

export type PartyCharacterChangeResult = PartyCharacterChangeSuccess | PartyJoinFailure

export type PartyOrderChangeResult = PartyCharacterChangeSuccess | PartyJoinFailure

export interface PartyChatInput {
  text: unknown
  clientMessageId?: unknown
}

export interface PartyChatSuccess {
  ok: true
  message: PartyChatMessage
  peers: PartyPeer[]
}

export interface PartyChatFailure {
  ok: false
  code: string
  message: string
}

export type PartyChatResult = PartyChatSuccess | PartyChatFailure

export interface ConnectionLogState {
  openedAt: number
  disconnected: boolean
  replaced?: boolean
  roomId?: string
  sessionId?: string
  participantId?: string
  nickname?: string
}

// 동기 삭제·쿼터 반환·presence 전송을 저장 대기보다 먼저 수행한다.
export interface PartyCloseDetails {
  code?: number
  reason?: string
  serverReason?: string
}
