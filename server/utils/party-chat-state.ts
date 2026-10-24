import { createHash } from 'node:crypto'
import {
  PARTY_CHARACTER_IDS,
  PARTY_ORDERS,
  PARTY_ROOM_ID_PATTERN,
  PARTY_SPECTATOR_ID,
  PARTY_UNSELECTED_ID,
  getPartyTextLength,
  type PartyCharacterId,
  type PartyConnectionDiagnostics,
  type PartyParticipant,
  type PartyOrder,
  type PartyRoomMessage,
  type PartyRoomSummary
} from '../../shared/types/party.ts'
import { postgresPartyChatStore, type PartyChatStore, type PartyConnectionEvent } from './party-chat-storage.ts'
import type { ConnectionLogState, JoinAttemptState, PartyConnection, PartyCreateResult, PartyPeer, PartyPresenceUpdate, PartyRoom, PendingDeparture } from './party-chat-types.ts'
import { PARTY_LIMITS } from './party-chat-limits.ts'

export function createPartyChatState() {
  const state = {
    store: postgresPartyChatStore,
    shuttingDown: false,
    presenceListener: undefined as ((update: PartyPresenceUpdate) => void) | undefined
  }
  const rooms = new Map<string, PartyRoom>()
  const roomCreations = new Map<string, Promise<PartyCreateResult>>()
  const connections = new Map<PartyPeer, PartyConnection>()
  const activeConnectionsByIp = new Map<string, number>()
  const joinAttemptsByIp = new Map<string, JoinAttemptState>()
  const connectionLogs = new WeakMap<PartyPeer, ConnectionLogState>()

  function logEvent(event: PartyConnectionEvent): void {
    void state.store.recordConnectionEvent(event).catch(console.error)
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

  function setPartyChatStore(store: PartyChatStore): void {
    state.store = store
  }

  function getRetainedPartySessionIds(): string[] {
    return [...rooms.values()].map(room => room.sessionId)
  }

  function getTextLength(value: string): number {
    return getPartyTextLength(value)
  }

  function normalizePartyRoomId(value: unknown): string | null {
    if (typeof value !== 'string') return null

    const normalized = value.trim()
    return PARTY_ROOM_ID_PATTERN.test(normalized) ? normalized : null
  }

  function normalizePartyNickname(value: unknown): string | null {
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
  function isPartyNicknameTaken(
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
      if (connection.participant.reconnectTokenHash !== reconnectTokenHash) continue
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
  function canResumePartyParticipant(
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

  function normalizePartyChatText(value: unknown): string | null {
    if (typeof value !== 'string') return null

    const normalized = value.trim()
    if (!normalized || getTextLength(normalized) > PARTY_LIMITS.maxTextLength) {
      return null
    }

    return normalized
  }

  function isPartyCharacterId(value: unknown): value is PartyCharacterId {
    return typeof value === 'string'
      && (value === PARTY_SPECTATOR_ID || value === PARTY_UNSELECTED_ID || PARTY_CHARACTER_IDS.some(id => id === value))
  }

  function isPartyOrder(value: unknown): value is PartyOrder {
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
    let removedCount = 0
    while (room.messages.length - removedCount > PARTY_LIMITS.historyLimit || room.historyBytes > PARTY_LIMITS.historyMaxBytes) {
      const removed = room.messages[removedCount]
      if (!removed) break
      room.messageIds.delete(removed.id)
      room.historyBytes -= room.messageSizes[removedCount] ?? 0
      removedCount++
    }
    if (!removedCount) return
    room.messages.splice(0, removedCount)
    room.messageSizes.splice(0, removedCount)
  }

  function appendRoomMessage(room: PartyRoom, message: PartyRoomMessage): void {
    if (room.messageIds.has(message.id)) return
    const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8') + 1
    room.messageIds.add(message.id)
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
    const stored = await state.store.appendMessage(room.sessionId, message, leftParticipantId)
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
    const participants: PartyParticipant[] = []
    for (const connection of room.participants.values()) {
      if (connection.participant) participants.push(cloneParticipant(connection.participant))
    }
    return participants
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

  return { state, rooms, roomCreations, connections, activeConnectionsByIp, joinAttemptsByIp, connectionLogs, logEvent, participantEvent, sanitizeDiagnostics, setPartyChatStore, getRetainedPartySessionIds, getTextLength, normalizePartyRoomId, normalizePartyNickname, nicknameKey, normalizeReconnectToken, hashReconnectToken, isPartyNicknameTaken, findReconnectOwner, clearPendingTimer, canResumePartyParticipant, normalizePartyChatText, isPartyCharacterId, isPartyOrder, cloneParticipant, cloneMessage, trimRoomHistory, appendRoomMessage, queueRoomWrite, appendRoomMessageNow, persistRoomMessage, applyParticipantProfile, syncParticipantMessages, getParticipants, getRoomSummary, pruneJoinAttempts, consumeJoinAttempt, releaseConnectionQuota, setEmptySince }
}

export type PartyChatState = ReturnType<typeof createPartyChatState>
