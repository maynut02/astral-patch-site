import { createHash, randomUUID } from 'node:crypto'
import {
  PARTY_CHARACTER_IDS,
  PARTY_CLOSE_LEAVE,
  PARTY_CLOSE_PAGE_HIDE,
  PARTY_HISTORY_MAX_BYTES,
  PARTY_HISTORY_MAX_MESSAGES,
  PARTY_MAX_NICKNAME_LENGTH,
  PARTY_MAX_TEXT_LENGTH,
  PARTY_ORDERS,
  PARTY_ROOM_ID_PATTERN,
  PARTY_SPECTATOR_ID,
  PARTY_UNSELECTED_ID,
  getPartyTextLength,
  type PartyCharacterId,
  type PartyChatMessage,
  type PartyConnectionDiagnostics,
  type PartyJoinNotice,
  type PartyLeaveNotice,
  type PartyParticipant,
  type PartyOrder,
  type PartyRoomMessage,
  type PartyRoomSummary
} from '../../shared/types/party.ts'
import { postgresPartyChatStore, type PartyChatStore, type PartyConnectionEvent } from './party-chat-storage.ts'

export const PARTY_LIMITS = Object.freeze({
  maxRooms: 200,
  maxConnections: 500,
  maxConnectionsPerIp: 20,
  maxJoinAttemptsPerIp: 12,
  joinAttemptWindowMs: 60_000,
  maxMessagesPerWindow: 60,
  messageWindowMs: 60_000,
  maxIncomingMessageBytes: 16 * 1024,
  maxOutgoingMessageBytes: 1024 * 1024,
  maxBufferedBytes: 1024 * 1024,
  emptyRoomTtlMs: 3 * 60_000,
  pageHideGraceMs: 15_000,
  connectionLossGraceMs: 60_000,
  heartbeatIntervalMs: 20_000,
  heartbeatTimeoutMs: 60_000,
  maxNicknameLength: PARTY_MAX_NICKNAME_LENGTH,
  maxTextLength: PARTY_MAX_TEXT_LENGTH,
  maxClientMessageIdLength: 128,
  maxReconnectTokenLength: 128,
  historyLimit: PARTY_HISTORY_MAX_MESSAGES,
  historyMaxBytes: PARTY_HISTORY_MAX_BYTES
})

const HEARTBEAT_PING_PAYLOAD = 'party-presence'

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

interface PartyConnection {
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
  reconnectTokenHash?: string
  room?: PartyRoom
  participant?: PartyParticipant
}

// 연결이 끊긴 참가자의 닉네임·토큰 예약. 실시간 맵과 분리해 보관한다.
interface PendingDeparture {
  participant: PartyParticipant
  reconnectTokenHash: string
  departure: 'page-hide' | 'loss' | 'restored'
  restored: boolean
  disconnectedAt: number
  expiresAt: number
  generation: number
  timer?: ReturnType<typeof setTimeout>
}

interface PartyRoom {
  roomId: string
  sessionId: string
  createdAt: string
  participants: Map<PartyPeer, PartyConnection>
  // 유예 예약은 실시간 참가자 맵과 별도로 participantId 기준으로만 보관한다.
  pendingDepartures: Map<string, PendingDeparture>
  departureGeneration: number
  clientMessages: Map<string, PartyChatMessage>
  messages: PartyRoomMessage[]
  messageSizes: number[]
  historyBytes: number
  emptySinceMs: number | null
  writeQueue: Promise<void>
}

interface JoinAttemptState {
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

const rooms = new Map<string, PartyRoom>()
const roomCreations = new Map<string, Promise<PartyCreateResult>>()
const connections = new Map<PartyPeer, PartyConnection>()
const activeConnectionsByIp = new Map<string, number>()
const joinAttemptsByIp = new Map<string, JoinAttemptState>()
let partyChatStore: PartyChatStore = postgresPartyChatStore

let maintenanceTimer: ReturnType<typeof setInterval> | undefined
let presenceListener: ((update: PartyPresenceUpdate) => void) | undefined
let shuttingDown = false

interface ConnectionLogState {
  openedAt: number
  disconnected: boolean
  replaced?: boolean
  roomId?: string
  sessionId?: string
  participantId?: string
  nickname?: string
}

const connectionLogs = new WeakMap<PartyPeer, ConnectionLogState>()

function logEvent(event: PartyConnectionEvent): void {
  void partyChatStore.recordConnectionEvent(event).catch(console.error)
}

function participantEvent(room: PartyRoom, participant: PartyParticipant): Pick<PartyConnectionEvent, 'roomId' | 'sessionId' | 'participantId' | 'nickname'> {
  return { roomId: room.roomId, sessionId: room.sessionId, participantId: participant.id, nickname: participant.nickname }
}

function sanitizeDiagnostics(value: unknown): PartyConnectionDiagnostics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of ['attempt', 'lastCloseCode', 'lastCloseAgoMs']) {
    const item = input[key]
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) result[key] = item
  }
  for (const key of ['hiddenAtClose', 'onlineAtClose']) {
    if (typeof input[key] === 'boolean') result[key] = input[key]
  }
  for (const key of ['lastCloseReason', 'navigationType']) {
    const item = input[key]
    if (typeof item === 'string' && item.length <= 64) result[key] = item
  }
  return result
}

export function beginPartyShutdown(): void {
  shuttingDown = true
  if (maintenanceTimer) clearInterval(maintenanceTimer)
  maintenanceTimer = undefined
  for (const room of rooms.values()) {
    for (const pending of room.pendingDepartures.values()) clearPendingTimer(pending)
  }
}

export async function finishPartyShutdown(): Promise<void> {
  beginPartyShutdown()
  await Promise.all([...rooms.values()].map(room => room.writeQueue))
  await partyChatStore.recordConnectionEvent({ event: 'server_shutdown' }).catch(console.error)
}

export function setPartyChatStore(store: PartyChatStore): void {
  partyChatStore = store
}

export function getRetainedPartySessionIds(): string[] {
  return [...rooms.values()].map(room => room.sessionId)
}

function getTextLength(value: string): number {
  return getPartyTextLength(value)
}

export function normalizePartyRoomId(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return PARTY_ROOM_ID_PATTERN.test(normalized) ? normalized : null
}

export function normalizePartyNickname(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized || getTextLength(normalized) > PARTY_LIMITS.maxNicknameLength) {
    return null
  }

  return normalized
}

function nicknameKey(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

function normalizeReconnectToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > PARTY_LIMITS.maxReconnectTokenLength) return null
  return normalized
}

function hashReconnectToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// 유예 중인 예약도 닉네임을 점유하므로 함께 검사한다.
export function isPartyNicknameTaken(
  roomId: string,
  nickname: string,
  excludeParticipantId?: string
): boolean {
  const room = rooms.get(roomId)
  if (!room) return false

  const key = nicknameKey(nickname)
  const liveTaken = [...room.participants.values()]
    .some(connection => connection.participant
      && connection.participant.id !== excludeParticipantId
      && nicknameKey(connection.participant.nickname) === key)
  if (liveTaken) return true

  const now = Date.now()
  for (const pending of room.pendingDepartures.values()) {
    if (pending.participant.id === excludeParticipantId) continue
    if (now >= pending.expiresAt) continue
    if (nicknameKey(pending.participant.nickname) === key) return true
  }
  return false
}

interface ReconnectOwner {
  participant: PartyParticipant
  reconnectTokenHash: string
  pending: boolean
  pendingDeparture?: PendingDeparture
}

// 실시간 연결과 유예 예약에서 토큰 소유자를 찾는다.
// ignoreExpiry: 입장이 방 큐를 잡은 동안에는 만료 작업이 그 뒤에 실행되므로, 남아 있는 예약은 아직 유효하다.
function findReconnectOwner(room: PartyRoom, reconnectToken: string, now: number, ignoreExpiry = false): ReconnectOwner | null {
  const reconnectTokenHash = hashReconnectToken(reconnectToken)
  for (const connection of room.participants.values()) {
    if (!connection.participant || connection.closed) continue
    if (connection.reconnectTokenHash !== reconnectTokenHash) continue
    return {
      participant: connection.participant,
      reconnectTokenHash,
      pending: false
    }
  }

  for (const pending of room.pendingDepartures.values()) {
    if (pending.reconnectTokenHash !== reconnectTokenHash) continue
    if (!ignoreExpiry && now >= pending.expiresAt) continue
    return {
      participant: pending.participant,
      reconnectTokenHash,
      pending: true,
      pendingDeparture: pending
    }
  }

  return null
}

function clearPendingTimer(pending: PendingDeparture): void {
  if (pending.timer) clearTimeout(pending.timer)
  pending.timer = undefined
}

// 닉네임 변경 없이 실제로 살아 있는 참가자(또는 유예 중 예약) 소유권만 인정한다.
export function canResumePartyParticipant(
  roomId: string,
  nickname: string,
  reconnectToken: unknown
): boolean {
  const room = rooms.get(roomId)
  if (!room) return false

  const normalizedNickname = normalizePartyNickname(nickname)
  const token = normalizeReconnectToken(reconnectToken)
  if (!normalizedNickname || !token) return false

  const owner = findReconnectOwner(room, token, Date.now())
  if (!owner) return false

  return nicknameKey(owner.participant.nickname) === nicknameKey(normalizedNickname)
}

export function normalizePartyChatText(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized || getTextLength(normalized) > PARTY_LIMITS.maxTextLength) {
    return null
  }

  return normalized
}

export function isPartyCharacterId(value: unknown): value is PartyCharacterId {
  return typeof value === 'string'
    && (value === PARTY_SPECTATOR_ID || value === PARTY_UNSELECTED_ID || PARTY_CHARACTER_IDS.some(id => id === value))
}

export function isPartyOrder(value: unknown): value is PartyOrder {
  return typeof value === 'string' && PARTY_ORDERS.some(order => order === value)
}

function cloneParticipant(participant: PartyParticipant): PartyParticipant {
  return {
    id: participant.id,
    nickname: participant.nickname,
    characterId: participant.characterId,
    order: participant.order
  }
}

function cloneMessage(message: PartyRoomMessage): PartyRoomMessage {
  if (message.kind !== 'chat') return { ...message }
  return { ...message, participant: cloneParticipant(message.participant) }
}

function trimRoomHistory(room: PartyRoom): void {
  while (room.messages.length > PARTY_LIMITS.historyLimit || room.historyBytes > PARTY_LIMITS.historyMaxBytes) {
    room.messages.shift()
    room.historyBytes -= room.messageSizes.shift() ?? 0
  }
}

function appendRoomMessage(room: PartyRoom, message: PartyRoomMessage): void {
  if (room.messages.some(existing => existing.id === message.id)) return
  const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8') + 1
  room.messages.push(message)
  room.messageSizes.push(bytes)
  room.historyBytes += bytes
  if (message.kind === 'chat' && message.clientMessageId) {
    room.clientMessages.set(`${message.participant.id}:${message.clientMessageId}`, message)
    if (room.clientMessages.size > PARTY_LIMITS.historyLimit * 2) {
      const oldestKey = room.clientMessages.keys().next().value
      if (oldestKey) room.clientMessages.delete(oldestKey)
    }
  }
  trimRoomHistory(room)
}

function queueRoomWrite<T>(room: PartyRoom, operation: () => Promise<T>): Promise<T> {
  const result = room.writeQueue.then(operation)
  room.writeQueue = result.then(() => undefined, () => undefined)
  return result
}

// 큐 안에서 이미 실행 중이면 다시 큐에 넣지 않고 저장만 수행한다.
async function appendRoomMessageNow(room: PartyRoom, message: PartyRoomMessage, leftParticipantId?: string): Promise<PartyRoomMessage> {
  const stored = await partyChatStore.appendMessage(room.sessionId, message, leftParticipantId)
  // A DB duplicate outside the in-memory history is acknowledged, not re-appended.
  if (stored.id === message.id) appendRoomMessage(room, stored)
  return stored
}

function persistRoomMessage(room: PartyRoom, message: PartyRoomMessage): Promise<PartyRoomMessage> {
  return queueRoomWrite(room, () => appendRoomMessageNow(room, message))
}

// 유예 예약 사본만 프로필 변경 내용으로 갱신한다. 실시간 맵은 건드리지 않는다.
function applyParticipantProfile(
  room: PartyRoom,
  participantId: string,
  updated: PartyParticipant
): void {
  const pending = room.pendingDepartures.get(participantId)
  if (!pending) return
  pending.participant.characterId = updated.characterId
  pending.participant.order = updated.order
}

function syncParticipantMessages(room: PartyRoom, participant: PartyParticipant): void {
  for (const [index, message] of room.messages.entries()) {
    if (message.kind !== 'chat' || message.participant.id !== participant.id) continue

    message.participant.characterId = participant.characterId
    message.participant.order = participant.order
    const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8') + 1
    room.historyBytes += bytes - (room.messageSizes[index] ?? 0)
    room.messageSizes[index] = bytes
  }
  for (const cached of room.clientMessages.values()) {
    if (cached.participant.id !== participant.id) continue
    cached.participant.characterId = participant.characterId
    cached.participant.order = participant.order
  }
  trimRoomHistory(room)
}

function getParticipants(room: PartyRoom): PartyParticipant[] {
  return [...room.participants.values()]
    .flatMap(connection => connection.participant ? [cloneParticipant(connection.participant)] : [])
}

function getRoomSummary(room: PartyRoom): PartyRoomSummary {
  return {
    roomId: room.roomId,
    participantCount: room.participants.size,
    createdAt: room.createdAt
  }
}

function pruneJoinAttempts(now: number): void {
  for (const [ipAddress, attempt] of joinAttemptsByIp) {
    if (now - attempt.windowStartedAt >= PARTY_LIMITS.joinAttemptWindowMs) {
      joinAttemptsByIp.delete(ipAddress)
    }
  }
}

function consumeJoinAttempt(ipAddress: string, now: number): { allowed: boolean, retryAfterMs: number } {
  const current = joinAttemptsByIp.get(ipAddress)

  if (!current || now - current.windowStartedAt >= PARTY_LIMITS.joinAttemptWindowMs) {
    joinAttemptsByIp.set(ipAddress, {
      count: 1,
      windowStartedAt: now
    })
    return { allowed: true, retryAfterMs: 0 }
  }

  current.count++
  return {
    allowed: current.count <= PARTY_LIMITS.maxJoinAttemptsPerIp,
    retryAfterMs: Math.max(0, current.windowStartedAt + PARTY_LIMITS.joinAttemptWindowMs - now)
  }
}

function releaseConnectionQuota(connection: PartyConnection): void {
  const activeForIp = activeConnectionsByIp.get(connection.ipAddress) || 0
  if (activeForIp <= 1) {
    activeConnectionsByIp.delete(connection.ipAddress)
  } else {
    activeConnectionsByIp.set(connection.ipAddress, activeForIp - 1)
  }
}

function setEmptySince(room: PartyRoom, now: number): void {
  room.emptySinceMs = room.participants.size === 0
    ? now
    : null
}

function buildLeaveNotice(participant: PartyParticipant, now: number): PartyLeaveNotice {
  return {
    kind: 'leave',
    id: randomUUID(),
    nickname: participant.nickname,
    createdAt: new Date(now).toISOString()
  }
}

function publishLeave(notice: PartyLeaveNotice, roomId: string): void {
  if (shuttingDown) return
  presenceListener?.({
    roomId,
    notice: { ...notice }
  })
}

function publishParticipants(room: PartyRoom): void {
  if (shuttingDown) return
  presenceListener?.({
    roomId: room.roomId,
    participants: getParticipants(room)
  })
}

// 명시적 퇴장은 저장에 성공한 뒤에만 공지를 한 번 방송한다.
async function finalizeLeave(room: PartyRoom, participant: PartyParticipant): Promise<void> {
  const notice = buildLeaveNotice(participant, Date.now())
  try {
    await queueRoomWrite(room, async () => {
      await appendRoomMessageNow(room, notice, participant.id)
      if (room.participants.size === 0 && room.pendingDepartures.size === 0) {
        // 만료 시각은 이벤트 시각이 아니라 현재 시계로 계산한다.
        await partyChatStore.setRoomExpiry(
          room.sessionId,
          new Date(Date.now() + PARTY_LIMITS.emptyRoomTtlMs).toISOString()
        ).catch(error => console.error('[party] Failed to shorten empty room expiry', error))
      }
    })
  } catch (error) {
    console.error('[party] Failed to save leave notice', error)
    return
  }

  publishLeave(notice, room.roomId)
  logEvent({ event: 'leave_notice', ...participantEvent(room, participant), departure: 'leave' })
}

interface PersistedAdmission {
  id: string
  // 이미 있던 신원(재개)인지, 이번 입장에서 새로 만든 신원인지
  existing: boolean
}

// 저장 뒤 취소된 입장: 새 신원은 재시작 후 복원되지 않게 닫고, 유예 중인 기존 신원은 마감 시각을 다시 기록한다.
async function revertAdmission(room: PartyRoom, persisted: PersistedAdmission[]): Promise<void> {
  try {
    for (const entry of persisted) {
      if (!entry.existing) {
        await partyChatStore.discardParticipant(entry.id)
        continue
      }
      const pending = room.pendingDepartures.get(entry.id)
      if (pending) await partyChatStore.setDepartureDeadline(entry.id, new Date(pending.expiresAt).toISOString())
    }
  } catch (error) {
    console.error('[party] Failed to revert cancelled admission', error)
  }
}

function scheduleDepartureTimer(pending: PendingDeparture, delayMs: number, onExpire: () => void): void {
  if (pending.timer) clearTimeout(pending.timer)
  const timer = setTimeout(onExpire, Math.max(0, delayMs))
  timer.unref?.()
  pending.timer = timer
}

function reservePendingDeparture(
  room: PartyRoom,
  participant: PartyParticipant,
  reconnectTokenHash: string,
  now: number,
  expiresAt: number,
  departure: PendingDeparture['departure'],
  restored = false
): void {
  const existing = room.pendingDepartures.get(participant.id)
  if (existing) clearPendingTimer(existing)

  room.departureGeneration += 1
  const generation = room.departureGeneration
  const pending: PendingDeparture = {
    participant: cloneParticipant(participant),
    reconnectTokenHash,
    departure,
    restored,
    disconnectedAt: now,
    expiresAt,
    generation
  }
  room.pendingDepartures.set(participant.id, pending)
  if (expiresAt <= Date.now()) {
    expirePendingDeparture(room, participant.id, generation)
    return
  }
  scheduleDepartureTimer(pending, pending.expiresAt - Date.now(), () => {
    expirePendingDeparture(room, participant.id, generation)
  })
}

// 만료와 재연결은 같은 큐에서 직렬화되고, 늦게 도착한 타이머는 세대 검사로 무시된다.
function expirePendingDeparture(room: PartyRoom, participantId: string, generation: number): void {
  void queueRoomWrite(room, async () => {
    if (shuttingDown) return
    if (rooms.get(room.roomId) !== room) return
    const pending = room.pendingDepartures.get(participantId)
    if (!pending || pending.generation !== generation) return

    const currentNow = Date.now()
    if (currentNow < pending.expiresAt) {
      scheduleDepartureTimer(pending, pending.expiresAt - currentNow, () => {
        expirePendingDeparture(room, participantId, generation)
      })
      return
    }

    room.pendingDepartures.delete(participantId)
    clearPendingTimer(pending)
    setEmptySince(room, currentNow)
    const notice = buildLeaveNotice(pending.participant, currentNow)
    try {
      await appendRoomMessageNow(room, notice, pending.participant.id)
    } catch (error) {
      console.error('[party] Failed to save leave notice', error)
      return
    }

    publishLeave(notice, room.roomId)
    logEvent({ event: 'leave_notice', ...participantEvent(room, pending.participant), departure: pending.departure })
    maybeStopMaintenance()
  }).catch(error => console.error('[party] Failed to expire pending departure', error))
}

function pruneEmptyRooms(now: number): void {
  for (const [roomId, room] of rooms) {
    if (
      room.participants.size === 0
      && room.pendingDepartures.size === 0
      && room.emptySinceMs !== null
      && now - room.emptySinceMs >= PARTY_LIMITS.emptyRoomTtlMs
    ) {
      // 삭제된 방의 유예 타이머가 뒤늦게 실행되어도 다시 살아나지 않게 정리한다.
      for (const pending of room.pendingDepartures.values()) clearPendingTimer(pending)
      room.pendingDepartures.clear()
      rooms.delete(roomId)
      void room.writeQueue.then(() => partyChatStore.deleteRoom(room.sessionId))
        .catch(error => console.error('[party] Failed to delete expired room', error))
    }
  }
}

function maybeStopMaintenance(): void {
  if (rooms.size > 0 || connections.size > 0 || !maintenanceTimer) {
    return
  }

  clearInterval(maintenanceTimer)
  maintenanceTimer = undefined
}

function ensureMaintenance(): void {
  if (maintenanceTimer || shuttingDown) return

  maintenanceTimer = setInterval(() => {
    const now = Date.now()
    pruneJoinAttempts(now)

    for (const connection of [...connections.values()]) {
      if (now - connection.lastSeenAt <= PARTY_LIMITS.heartbeatTimeoutMs) continue

      void removePartyConnection(connection.peer, now, { code: 1013, reason: 'heartbeat-timeout', serverReason: 'heartbeat-timeout' })
        .catch(error => console.error('[party] Failed to remove stale peer', error))
      try {
        connection.peer.close(1013, 'heartbeat-timeout')
      } catch {
        // The adapter may already have closed the peer.
      }
    }

    for (const connection of [...connections.values()]) {
      if (!connection.participant) continue
      try {
        const websocket = connection.peer.websocket
        if (websocket?.ping) websocket.ping(HEARTBEAT_PING_PAYLOAD)
        else connection.peer.ping?.(HEARTBEAT_PING_PAYLOAD)
      } catch {
        void removePartyConnection(connection.peer, now, { code: 1013, reason: 'heartbeat-error', serverReason: 'heartbeat-error' })
          .catch(error => console.error('[party] Failed to remove peer', error))
        try {
          connection.peer.close(1013, 'heartbeat-error')
        } catch {
          // The adapter may already have closed the peer.
        }
      }
    }

    for (const room of rooms.values()) {
      if (room.participants.size > 0 || room.pendingDepartures.size > 0) {
        void queueRoomWrite(room, () => partyChatStore.extendRoom(room.sessionId, new Date(now + PARTY_LIMITS.emptyRoomTtlMs).toISOString()))
          .catch(error => console.error('[party] Failed to renew room', error))
      }
    }

    pruneEmptyRooms(now)
    maybeStopMaintenance()
  }, PARTY_LIMITS.heartbeatIntervalMs)

  maintenanceTimer.unref?.()
}

function hydrateRoom(roomId: string, stored: Awaited<ReturnType<PartyChatStore['openRoom']>>, restored: boolean): PartyRoom {
  const room: PartyRoom = {
    roomId,
    sessionId: stored.sessionId,
    createdAt: stored.createdAt,
    participants: new Map(),
    pendingDepartures: new Map(),
    departureGeneration: 0,
    clientMessages: new Map(),
    messages: [],
    messageSizes: [],
    historyBytes: 0,
    emptySinceMs: Date.parse(stored.expiresAt) - PARTY_LIMITS.emptyRoomTtlMs,
    writeQueue: Promise.resolve()
  }
  for (const message of stored.messages) appendRoomMessage(room, message)
  rooms.set(roomId, room)
  const now = Date.now()
  for (const participant of stored.participants) {
    reservePendingDeparture(
      room, participant, participant.reconnectTokenHash, now,
      participant.departureDeadline === null ? now + PARTY_LIMITS.connectionLossGraceMs : Date.parse(participant.departureDeadline),
      'restored', true
    )
  }
  if (restored) {
    room.emptySinceMs = now
    void queueRoomWrite(room, () => partyChatStore.extendRoom(room.sessionId, new Date(now + PARTY_LIMITS.emptyRoomTtlMs).toISOString()))
      .catch(error => console.error('[party] Failed to renew restored room', error))
    logEvent({ event: 'room_restored', roomId, sessionId: room.sessionId, detail: { participants: stored.participants.length } })
  }
  ensureMaintenance()
  return room
}

async function findPartyRoom(roomId: string): Promise<PartyRoom | null> {
  const current = rooms.get(roomId)
  if (current) return current
  const pending = roomCreations.get(roomId)
  if (pending) {
    await pending
    return rooms.get(roomId) ?? null
  }
  const stored = await partyChatStore.findRoom(roomId)
  if (!stored) return null
  return rooms.get(roomId) ?? hydrateRoom(roomId, stored, true)
}

export async function createPartyRoom(roomIdInput: unknown): Promise<PartyCreateResult> {
  const roomId = normalizePartyRoomId(roomIdInput)
  if (!roomId) {
    return {
      ok: false,
      code: 'INVALID_ROOM_ID',
      message: '방 번호는 숫자 6자리여야 합니다.'
    }
  }

  pruneEmptyRooms(Date.now())

  const existing = rooms.get(roomId)
  if (existing) return { ok: true, room: getRoomSummary(existing) }

  const pending = roomCreations.get(roomId)
  if (pending) return pending

  if (rooms.size + roomCreations.size >= PARTY_LIMITS.maxRooms) {
    return {
      ok: false,
      code: 'ROOM_LIMIT',
      message: '생성된 방이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    }
  }

  const creation = (async (): Promise<PartyCreateResult> => {
    const createdAtMs = Date.now()
    const sessionId = randomUUID()
    const stored = await partyChatStore.openRoom(
      roomId,
      sessionId,
      new Date(createdAtMs).toISOString(),
      new Date(createdAtMs + PARTY_LIMITS.emptyRoomTtlMs).toISOString()
    )
    const room = rooms.get(roomId) ?? hydrateRoom(roomId, stored, stored.sessionId !== sessionId)
    return { ok: true, room: getRoomSummary(room) }
  })()
  roomCreations.set(roomId, creation)
  try {
    return await creation
  } finally {
    roomCreations.delete(roomId)
  }
}

export function getPartyRoom(roomIdInput: unknown): PartyRoomSummary | null {
  const roomId = normalizePartyRoomId(roomIdInput)
  if (!roomId) return null

  pruneEmptyRooms(Date.now())
  const room = rooms.get(roomId)
  return room ? getRoomSummary(room) : null
}

export function registerPartyConnection(peer: PartyPeer, ipAddress: string): boolean {
  if (connections.has(peer)) return true
  if (!connectionLogs.has(peer)) {
    connectionLogs.set(peer, { openedAt: Date.now(), disconnected: false })
    logEvent({ event: 'connect', connectionId: peer.id, detail: { userAgent: peer.request?.headers.get('user-agent')?.slice(0, 256) } })
  }
  if (connections.size >= PARTY_LIMITS.maxConnections) return false

  const normalizedIpAddress = ipAddress.trim() || 'unknown'
  const activeForIp = activeConnectionsByIp.get(normalizedIpAddress) || 0
  if (activeForIp >= PARTY_LIMITS.maxConnectionsPerIp) return false

  const now = Date.now()
  connections.set(peer, {
    peer,
    ipAddress: normalizedIpAddress,
    lastSeenAt: now,
    messageWindowStartedAt: now,
    messageCount: 0,
    closed: false,
    joining: false,
    suppressJoinNotice: false,
    replacedByTakeover: false
  })
  activeConnectionsByIp.set(normalizedIpAddress, activeForIp + 1)
  ensureMaintenance()
  return true
}

export function touchPartyConnection(peer: PartyPeer): boolean {
  const connection = connections.get(peer)
  if (!connection || connection.closed) return false

  connection.lastSeenAt = Date.now()
  return true
}

export function consumePartyMessage(peer: PartyPeer): boolean {
  const connection = connections.get(peer)
  if (!connection || connection.closed) return false

  const now = Date.now()
  if (now - connection.messageWindowStartedAt >= PARTY_LIMITS.messageWindowMs) {
    connection.messageWindowStartedAt = now
    connection.messageCount = 0
  }

  connection.messageCount++
  connection.lastSeenAt = now
  return connection.messageCount <= PARTY_LIMITS.maxMessagesPerWindow
}

export async function joinPartyRoom(peer: PartyPeer, input: PartyJoinInput): Promise<PartyJoinResult> {
  let result: PartyJoinResult
  try {
    result = await admitPartyParticipant(peer, input)
  } catch (error) {
    logEvent({ event: 'join_rejected', connectionId: peer.id, roomId: normalizePartyRoomId(input.roomId) ?? undefined, detail: { code: 'STORAGE_UNAVAILABLE' } })
    throw error
  }
  if (!result.ok) logEvent({ event: 'join_rejected', connectionId: peer.id, roomId: normalizePartyRoomId(input.roomId) ?? undefined, detail: { code: result.code } })
  return result
}

async function admitPartyParticipant(
  peer: PartyPeer,
  input: PartyJoinInput
): Promise<PartyJoinResult> {
  const connection = connections.get(peer)
  if (!connection || connection.closed) {
    return {
      ok: false,
      code: 'CONNECTION_CLOSED',
      message: '웹소켓 연결을 사용할 수 없습니다.'
    }
  }

  if (connection.joining || connection.room || connection.participant) {
    return {
      ok: false,
      code: 'ALREADY_JOINED',
      message: '이 연결은 이미 방에 입장했습니다.'
    }
  }

  const roomId = normalizePartyRoomId(input.roomId)
  if (!roomId) {
    return {
      ok: false,
      code: 'INVALID_ROOM_ID',
      message: '방 번호는 숫자 6자리여야 합니다.'
    }
  }

  const nickname = normalizePartyNickname(input.nickname)
  if (!nickname) {
    return {
      ok: false,
      code: 'INVALID_NICKNAME',
      message: '닉네임은 1~20자여야 합니다.'
    }
  }

  if (!isPartyCharacterId(input.characterId)) {
    return {
      ok: false,
      code: 'INVALID_CHARACTER',
      message: '캐릭터를 선택해 주세요.'
    }
  }

  if (input.characterId === PARTY_SPECTATOR_ID && input.order != null) {
    return { ok: false, code: 'SPECTATOR_ORDER_DISABLED', message: '관전 중에는 순서를 선택할 수 없습니다.' }
  }
  if (input.characterId !== PARTY_SPECTATOR_ID && input.order !== undefined && !isPartyOrder(input.order)) {
    return { ok: false, code: 'INVALID_ORDER', message: '올바른 순서를 선택해 주세요.' }
  }

  const providedToken = normalizeReconnectToken(input.reconnectToken)
  const now = Date.now()
  const existingRoom = rooms.get(roomId)
  const memoryOwner = providedToken && existingRoom ? findReconnectOwner(existingRoom, providedToken, now) : null
  const rateExempt = Boolean(
    memoryOwner && nicknameKey(memoryOwner.participant.nickname) === nicknameKey(nickname)
  )
  if (!rateExempt) {
    const attempt = consumeJoinAttempt(connection.ipAddress, now)
    if (!attempt.allowed) {
      return {
        ok: false,
        code: 'JOIN_RATE_LIMITED',
        message: '입장 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
        retryAfterMs: attempt.retryAfterMs
      }
    }
  }

  connection.joining = true
  try {
    const room = await findPartyRoom(roomId)
    if (!room) {
      return {
        ok: false,
        code: 'ROOM_NOT_FOUND',
        message: '방을 찾을 수 없습니다.'
      }
    }

    if (connection.closed || connection.room || connection.participant) {
      return {
        ok: false,
        code: 'CONNECTION_CLOSED',
        message: '웹소켓 연결을 사용할 수 없습니다.'
      }
    }

    const desiredOrder = input.characterId === PARTY_SPECTATOR_ID
      ? null
      : (input.order ?? PARTY_ORDERS[0]) as PartyOrder
    const desiredCharacterId = input.characterId
    let participant: PartyParticipant = {
      id: randomUUID(),
      nickname,
      characterId: desiredCharacterId,
      order: desiredOrder
    }
    let reconnectToken: string = randomUUID()
    let replacedPeer: PartyPeer | undefined
    let resumed = false
    let suppressJoinNotice = false
    let conflict: PartyJoinFailure | null = null
    let roomLost = false
    let restored = false
    let disconnectedMs: number | undefined

    // 저장 뒤 입장이 취소되면 같은 큐 안에서 DB 상태를 되돌리기 위해 저장한 신원을 기록한다.
    const persisted: PersistedAdmission[] = []
    const admitInQueue = async (): Promise<boolean> => {
      const isCurrentConnection = () => !connection.closed && !connection.room && !connection.participant
      // 방이 정리/교체됐으면 어떤 저장도 그 방에 반영하지 않는다.
      if (!isCurrentConnection()) return false
      if (rooms.get(room.roomId) !== room) {
        roomLost = true
        return false
      }

      const serializedNow = Date.now()
      const owner = providedToken ? findReconnectOwner(room, providedToken, serializedNow) : null
      const matchedOwner = owner && nicknameKey(owner.participant.nickname) === nicknameKey(nickname)
        ? owner
        : undefined

      // 이번 입장이 새 예산을 이미 소모했는지 추적해 중복 소모를 막는다.
      let budgetConsumed = false
      const consumeBudgetOnce = (now: number): boolean => {
        if (budgetConsumed) return true
        budgetConsumed = true
        const attempt = consumeJoinAttempt(connection.ipAddress, now)
        if (attempt.allowed) return true
        conflict = {
          ok: false,
          code: 'JOIN_RATE_LIMITED',
          message: '입장 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
          retryAfterMs: attempt.retryAfterMs
        }
        return false
      }

      // 유효 토큰 예외가 사라졌다면 이번 입장은 새 예산을 정확히 한 번 소모한다.
      if (!matchedOwner && rateExempt && !consumeBudgetOnce(serializedNow)) return false

      if (isPartyNicknameTaken(roomId, nickname, matchedOwner?.participant.id)) {
        const pending = [...room.pendingDepartures.values()]
          .find(departure => Date.now() < departure.expiresAt
            && departure.participant.id !== matchedOwner?.participant.id
            && nicknameKey(departure.participant.nickname) === nicknameKey(nickname))
        conflict = pending
          ? {
              ok: false,
              code: 'NICKNAME_TAKEN',
              message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.',
              retryAfterMs: Math.max(0, pending.expiresAt - serializedNow)
            }
          : {
              ok: false,
              code: 'NICKNAME_TAKEN',
              message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.'
            }
        return false
      }

      // 저장 전에 붙잡은 신원은 await 뒤에 다시 검증해야 한다.
      const resumeParticipantId = matchedOwner?.participant.id
      const resumeToken = matchedOwner ? providedToken : null

      if (matchedOwner) {
        participant = {
          id: matchedOwner.participant.id,
          nickname,
          characterId: desiredCharacterId,
          order: desiredOrder
        }
      }
      reconnectToken = matchedOwner && providedToken ? providedToken : reconnectToken
      await partyChatStore.upsertParticipant(room.sessionId, participant, hashReconnectToken(reconnectToken))
      persisted.push({ id: participant.id, existing: Boolean(matchedOwner) })

      await partyChatStore.extendRoom(room.sessionId, new Date(Date.now() + PARTY_LIMITS.emptyRoomTtlMs).toISOString())

      if (rooms.get(room.roomId) !== room) {
        roomLost = true
        return false
      }
      if (!isCurrentConnection()) return false

      if (resumeParticipantId) {
        // 재개 신원이 저장 대기 중 명시적으로 무효화됐는지만 확인한다. 저장 시간 때문에 유예 마감을 넘긴 것은 무효화가 아니다.
        const currentOwner = resumeToken ? findReconnectOwner(room, resumeToken, Date.now(), true) : null
        if (!currentOwner || currentOwner.participant.id !== resumeParticipantId) {
          // 무효화된 신원을 되살리지 않고 새 참가자로 다시 시작한다.
          if (isPartyNicknameTaken(roomId, nickname)) {
            const pending = [...room.pendingDepartures.values()]
              .find(departure => Date.now() < departure.expiresAt
                && nicknameKey(departure.participant.nickname) === nicknameKey(nickname))
            conflict = {
              ok: false,
              code: 'NICKNAME_TAKEN',
              message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.',
              ...(pending ? { retryAfterMs: Math.max(0, pending.expiresAt - Date.now()) } : {})
            }
            return false
          }

          // 무효화된 신원을 되살리지 않고, 새 예산을 한 번 소모한 뒤 새 참가자로 다시 시작한다.
          if (!consumeBudgetOnce(Date.now())) return false
          resumed = false
          suppressJoinNotice = false
          participant = {
            id: randomUUID(),
            nickname,
            characterId: desiredCharacterId,
            order: desiredOrder
          }
          reconnectToken = randomUUID()
          await partyChatStore.upsertParticipant(room.sessionId, participant, hashReconnectToken(reconnectToken))
          persisted.push({ id: participant.id, existing: false })
          if (rooms.get(room.roomId) !== room) {
            roomLost = true
            return false
          }
          if (!isCurrentConnection()) return false
        } else {
          resumed = true
          reconnectToken = providedToken!
          participant = {
            id: currentOwner.participant.id,
            nickname,
            characterId: desiredCharacterId,
            order: desiredOrder
          }
        }
      }

      for (const [activePeer, activeConn] of room.participants) {
        if (activeConn.participant?.id === participant.id && activePeer !== peer) {
          const oldLog = connectionLogs.get(activePeer)
          if (oldLog) oldLog.replaced = true
          activeConn.room = undefined
          activeConn.participant = undefined
          activeConn.closed = true
          activeConn.replacedByTakeover = true
          room.participants.delete(activePeer)
          // 이전 연결은 즉시 종료된 것으로 보고 쿼터를 바로 반환한다.
          connections.delete(activePeer)
          releaseConnectionQuota(activeConn)
          replacedPeer = activePeer
          suppressJoinNotice = true
          break
        }
      }

      // 유예 예약을 되살릴 때는 타이머를 취소해 저장 대기 중 만료가 끼어들지 않게 한다.
      const pendingDeparture = room.pendingDepartures.get(participant.id)
      if (pendingDeparture) {
        restored = pendingDeparture.restored
        disconnectedMs = Math.max(0, Date.now() - pendingDeparture.disconnectedAt)
        clearPendingTimer(pendingDeparture)
        room.pendingDepartures.delete(participant.id)
      }

      connection.room = room
      connection.participant = participant
      connection.reconnectTokenHash = hashReconnectToken(reconnectToken)
      // 재연결은 이전 연결이 살아 있든 유예 중이든 입·퇴장 공지를 모두 억제한다.
      connection.suppressJoinNotice = resumed || suppressJoinNotice
      room.participants.set(peer, connection)
      Object.assign(connectionLogs.get(peer)!, participantEvent(room, participant))
      syncParticipantMessages(room, participant)
      setEmptySince(room, Date.now())
      return true
    }
    const admitted = await queueRoomWrite(room, async () => {
      let ok = false
      try {
        ok = await admitInQueue()
      } finally {
        if (!ok && persisted.length > 0) await revertAdmission(room, persisted)
      }
      return ok
    })

    if (replacedPeer) {
      try {
        replacedPeer.close(1000, 'replaced-by-reconnect')
      } catch {
        // The previous socket may already be closed.
      }
    }

    if (!admitted) {
      if (conflict) return conflict
      if (roomLost) {
        return {
          ok: false,
          code: 'ROOM_NOT_FOUND',
          message: '방을 찾을 수 없습니다.'
        }
      }
      return connection.closed
        ? { ok: false, code: 'CONNECTION_CLOSED', message: '웹소켓 연결을 사용할 수 없습니다.' }
        : { ok: false, code: 'NICKNAME_TAKEN', message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.' }
    }

    logEvent({
      event: 'join', ...participantEvent(room, participant), connectionId: peer.id,
      detail: { resumed, restored, ...(disconnectedMs === undefined ? {} : { disconnectedMs }), diagnostics: sanitizeDiagnostics(input.diagnostics) }
    })
    return {
      ok: true,
      sessionId: room.sessionId,
      participantId: participant.id,
      reconnectToken,
      resumed,
      room: getRoomSummary(room),
      messages: room.messages.map(cloneMessage),
      participants: getParticipants(room)
    }
  } finally {
    connection.joining = false
  }
}

export async function recordPartyJoin(peer: PartyPeer): Promise<{ notice: PartyJoinNotice, peers: PartyPeer[] } | null> {
  const connection = connections.get(peer)
  if (!connection || connection.closed || !connection.room || !connection.participant) return null
  if (connection.suppressJoinNotice) {
    connection.suppressJoinNotice = false
    return null
  }

  const room = connection.room
  const participant = connection.participant
  const notice: PartyJoinNotice = {
    kind: 'join',
    id: randomUUID(),
    nickname: participant.nickname,
    createdAt: new Date().toISOString()
  }
  await persistRoomMessage(room, notice)
  // 저장 대기 중 연결이 끊겨도 보관한 방 객체로 수신자 목록을 만든다.
  return { notice: { ...notice }, peers: [...room.participants.keys()] }
}

export async function changePartyCharacter(peer: PartyPeer, characterId: unknown): Promise<PartyCharacterChangeResult> {
  const connection = connections.get(peer)
  if (!connection || connection.closed || !connection.room || !connection.participant) {
    return { ok: false, code: 'NOT_IN_ROOM', message: '방에 입장한 후 캐릭터를 변경할 수 있습니다.' }
  }
  if (!isPartyCharacterId(characterId)) {
    return { ok: false, code: 'INVALID_CHARACTER', message: '올바른 캐릭터를 선택해 주세요.' }
  }

  connection.lastSeenAt = Date.now()
  const room = connection.room
  const participant = connection.participant
  const acceptedConnection = connection
  return queueRoomWrite(room, async (): Promise<PartyCharacterChangeResult> => {
    // 인계 뒤 도착한 이전 연결의 프로필 작업은 현재 신원과 어긋나므로 적용하지 않는다.
    if (acceptedConnection.replacedByTakeover) {
      return { ok: false, code: 'NOT_IN_ROOM', message: '방에 입장한 후 캐릭터를 변경할 수 있습니다.' }
    }
    const updated = cloneParticipant(participant)
    updated.characterId = characterId
    if (characterId === PARTY_SPECTATOR_ID) updated.order = null
    else if (!updated.order) updated.order = PARTY_ORDERS[0]
    await partyChatStore.updateParticipant(updated)
    // 저장이 끝났으면 연결이 끊겼어도 이미 승인된 객체는 갱신하되 실시간 상태는 되살리지 않는다.
    participant.characterId = updated.characterId
    participant.order = updated.order
    applyParticipantProfile(room, participant.id, updated)
    syncParticipantMessages(room, updated)
    return {
      ok: true,
      roomId: room.roomId,
      participants: getParticipants(room)
    }
  })
}

export async function changePartyOrder(peer: PartyPeer, order: unknown): Promise<PartyOrderChangeResult> {
  const connection = connections.get(peer)
  if (!connection || connection.closed || !connection.room || !connection.participant) {
    return { ok: false, code: 'NOT_IN_ROOM', message: '방에 입장한 후 순서를 변경할 수 있습니다.' }
  }
  if (connection.participant.characterId === PARTY_SPECTATOR_ID) {
    return { ok: false, code: 'SPECTATOR_ORDER_DISABLED', message: '관전 중에는 순서를 선택할 수 없습니다.' }
  }
  if (!isPartyOrder(order)) {
    return { ok: false, code: 'INVALID_ORDER', message: '올바른 순서를 선택해 주세요.' }
  }

  connection.lastSeenAt = Date.now()
  const room = connection.room
  const participant = connection.participant
  const acceptedConnection = connection
  return queueRoomWrite(room, async (): Promise<PartyOrderChangeResult> => {
    // 인계 뒤 도착한 이전 연결의 프로필 작업은 현재 신원과 어긋나므로 적용하지 않는다.
    if (acceptedConnection.replacedByTakeover) {
      return { ok: false, code: 'NOT_IN_ROOM', message: '방에 입장한 후 순서를 변경할 수 있습니다.' }
    }
    if (participant.characterId === PARTY_SPECTATOR_ID) {
      return { ok: false, code: 'SPECTATOR_ORDER_DISABLED', message: '관전 중에는 순서를 선택할 수 없습니다.' }
    }
    const updated = { ...cloneParticipant(participant), order }
    await partyChatStore.updateParticipant(updated)
    participant.order = order
    applyParticipantProfile(room, participant.id, updated)
    syncParticipantMessages(room, updated)
    return {
      ok: true,
      roomId: room.roomId,
      participants: getParticipants(room)
    }
  })
}

export async function sendPartyChat(
  peer: PartyPeer,
  input: PartyChatInput
): Promise<PartyChatResult> {
  const connection = connections.get(peer)
  if (!connection || connection.closed || !connection.room || !connection.participant) {
    return {
      ok: false,
      code: 'NOT_IN_ROOM',
      message: '방에 입장한 후 채팅을 보낼 수 있습니다.'
    }
  }

  if (typeof input.text !== 'string' || !input.text.trim()) {
    return {
      ok: false,
      code: 'TEXT_REQUIRED',
      message: '메시지를 입력해 주세요.'
    }
  }

  const text = normalizePartyChatText(input.text)
  if (!text) {
    return {
      ok: false,
      code: 'TEXT_TOO_LONG',
      message: `메시지는 ${PARTY_LIMITS.maxTextLength}자 이하로 입력해 주세요.`
    }
  }

  let clientMessageId = ''
  if (input.clientMessageId !== undefined) {
    if (typeof input.clientMessageId !== 'string') {
      return {
        ok: false,
        code: 'INVALID_CLIENT_MESSAGE_ID',
        message: '클라이언트 메시지 ID는 문자열이어야 합니다.'
      }
    }

    clientMessageId = input.clientMessageId.trim()
    if (getTextLength(clientMessageId) > PARTY_LIMITS.maxClientMessageIdLength) {
      return {
        ok: false,
        code: 'INVALID_CLIENT_MESSAGE_ID',
        message: '클라이언트 메시지 ID가 너무 깁니다.'
      }
    }
  }

  connection.lastSeenAt = Date.now()
  const room = connection.room
  // 참가자 객체를 붙잡아 큐에서 연결이 닫혀도 실제 승인된 발신자 정보를 유지한다.
  const participant = connection.participant
  const participantId = participant.id
  const effectiveClientMessageId = clientMessageId || randomUUID()
  const dedupeKey = clientMessageId ? `${participantId}:${clientMessageId}` : ''
  const createdAt = new Date(connection.lastSeenAt).toISOString()

  const message = await queueRoomWrite(room, async () => {
    if (dedupeKey) {
      const existing = room.clientMessages.get(dedupeKey)
      if (existing) return existing
    }
    const created: PartyChatMessage = {
      kind: 'chat',
      id: randomUUID(),
      clientMessageId: effectiveClientMessageId,
      participant: cloneParticipant(participant),
      text,
      createdAt
    }
    const stored = await appendRoomMessageNow(room, created)
    if (stored.kind !== 'chat') throw new Error('Invalid stored chat message')
    return stored
  })

  return {
    ok: true,
    message: { ...message, participant: cloneParticipant(message.participant) },
    peers: [...room.participants.keys()]
  }
}

export async function getPartyHistory(peer: PartyPeer, before: unknown): Promise<{
  before: string
  messages: PartyRoomMessage[]
  hasMore: boolean
} | PartyJoinFailure> {
  const connection = connections.get(peer)
  if (!connection?.room || !connection.participant || connection.closed) {
    return { ok: false, code: 'NOT_IN_ROOM', message: '방에 입장한 후 기록을 볼 수 있습니다.' }
  }
  if (typeof before !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(before)) {
    return { ok: false, code: 'INVALID_CURSOR', message: '올바르지 않은 기록 위치입니다.' }
  }
  const history = await partyChatStore.getMessagesBefore(connection.room.sessionId, before, 50)
  return { before, ...history }
}

export function getPartyRoomPeers(roomIdInput: unknown): PartyPeer[] {
  const roomId = normalizePartyRoomId(roomIdInput)
  if (!roomId) return []

  const room = rooms.get(roomId)
  return room ? [...room.participants.keys()] : []
}

// 동기 삭제·쿼터 반환·presence 전송을 저장 대기보다 먼저 수행한다.
export interface PartyCloseDetails {
  code?: number
  reason?: string
  serverReason?: string
}

export async function removePartyConnection(
  peer: PartyPeer,
  now = Date.now(),
  details: PartyCloseDetails | 'loss' | 'leave' = 'loss'
): Promise<void> {
  const close: PartyCloseDetails = typeof details === 'string'
    ? details === 'leave' ? PARTY_CLOSE_LEAVE : {}
    : details
  const connection = connections.get(peer)
  const state = connectionLogs.get(peer)
  const departure = shuttingDown
    ? 'shutdown'
    : state?.replaced
      ? 'replaced'
      : !connection?.participant
          ? 'not-joined'
          : close.code === PARTY_CLOSE_LEAVE.code && close.reason === PARTY_CLOSE_LEAVE.reason
            ? 'leave'
            : close.code === 1001 || (close.code === PARTY_CLOSE_PAGE_HIDE.code && close.reason === PARTY_CLOSE_PAGE_HIDE.reason)
              ? 'page-hide'
              : 'loss'
  if (state && !state.disconnected) {
    state.disconnected = true
    logEvent({
      event: 'disconnect', roomId: state.roomId, sessionId: state.sessionId,
      participantId: state.participantId, nickname: state.nickname, connectionId: peer.id,
      closeCode: close.code, closeReason: close.reason, departure,
      connectedMs: Math.min(2_147_483_647, Math.max(0, now - state.openedAt)),
      detail: { ...(close.serverReason || state.replaced ? { serverReason: close.serverReason ?? 'replaced-by-reconnect' } : {}) }
    })
  }
  if (!connection) return

  connection.closed = true
  connections.delete(peer)
  releaseConnectionQuota(connection)

  const room = connection.room
  const participant = connection.participant
  const reconnectTokenHash = connection.reconnectTokenHash
  connection.room = undefined
  connection.participant = undefined
  connection.reconnectTokenHash = undefined

  if (!room || !participant) {
    maybeStopMaintenance()
    return
  }

  room.participants.delete(peer)
  if (shuttingDown) return
  // 빈 방 TTL도 이벤트 시각이 아니라 현재 시계에서 시작한다.
  setEmptySince(room, Date.now())

  if (departure === 'leave') {
    const pending = room.pendingDepartures.get(participant.id)
    if (pending) {
      clearPendingTimer(pending)
      room.pendingDepartures.delete(participant.id)
    }
    // 참가자 목록은 저장을 기다리지 않고 즉시 알리고, 퇴장 공지는 저장 성공 뒤 한 번만 보낸다.
    publishParticipants(room)
    await finalizeLeave(room, participant)
    maybeStopMaintenance()
    return
  }

  // heartbeat 만료도 감지 시점부터 유예한다. 마지막 수신 시각을 기준으로 하면 감지 순간 유예가 이미 끝나,
  // 클라이언트가 조용한 단절을 알아채고 다시 붙기 전에 토큰이 무효화된다.
  const deadline = now + (departure === 'page-hide' ? PARTY_LIMITS.pageHideGraceMs : PARTY_LIMITS.connectionLossGraceMs)
  reservePendingDeparture(room, participant, reconnectTokenHash!, now, deadline, departure === 'page-hide' ? 'page-hide' : 'loss')
  const pending = room.pendingDepartures.get(participant.id)!
  const write = queueRoomWrite(room, async () => {
    if (shuttingDown) return
    if (room.pendingDepartures.get(participant.id) !== pending) return
    await partyChatStore.setDepartureDeadline(participant.id, new Date(deadline).toISOString())
  })
  publishParticipants(room)
  await write
  maybeStopMaintenance()
}

export function setPartyPresenceListener(
  listener: ((update: PartyPresenceUpdate) => void) | undefined
): void {
  presenceListener = listener
}
