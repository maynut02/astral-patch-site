import { randomUUID } from 'node:crypto'
import type { PartyRoomSummary } from '../../shared/types/party.ts'
import type { PartyChatStore } from './party-chat-storage.ts'
import type { PartyCreateResult, PartyPeer, PartyRoom } from './party-chat-types.ts'
import { createPartyChatState } from './party-chat-state.ts'
import { PARTY_LIMITS } from './party-chat-limits.ts'
import { createPartyPresence } from './party-chat-presence.ts'
import { createPartyAdmission } from './party-chat-admission.ts'
import { createPartyMessages } from './party-chat-messages.ts'

const context = createPartyChatState()
const { state, rooms, roomCreations, connections, connectionLogs, activeConnectionsByIp, logEvent, clearPendingTimer, pruneJoinAttempts, queueRoomWrite, appendRoomMessage, getRoomSummary } = context
let maintenanceTimer: ReturnType<typeof setInterval> | undefined
const HEARTBEAT_PING_PAYLOAD = 'party-presence'

/** @internal 저장소 주입 및 방 조회 테스트 seam. */
export const { setPartyChatStore, getRetainedPartySessionIds, normalizePartyNickname, isPartyNicknameTaken, canResumePartyParticipant, normalizePartyRoomId, isPartyCharacterId } = context

export function getPartyChatStore(): PartyChatStore {
  return state.store
}

const presence = createPartyPresence(context, maybeStopMaintenance)
const { reservePendingDeparture } = presence
export const { removePartyConnection, setPartyPresenceListener } = presence
export const { joinPartyRoom } = createPartyAdmission(context, findPartyRoom)
export const { recordPartyJoin, changePartyCharacter, changePartyOrder, sendPartyChat, getPartyHistory, getPartyRoomPeers } = createPartyMessages(context)

export function beginPartyShutdown(): void {
  state.shuttingDown = true
  if (maintenanceTimer) clearInterval(maintenanceTimer)
  maintenanceTimer = undefined
  for (const room of rooms.values()) {
    for (const pending of room.pendingDepartures.values()) clearPendingTimer(pending)
  }
}

export async function finishPartyShutdown(): Promise<void> {
  beginPartyShutdown()
  await Promise.all([...rooms.values()].map(room => room.writeQueue))
  await state.store.recordConnectionEvent({ event: 'server_shutdown' }).catch(console.error)
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
      void room.writeQueue.then(() => state.store.deleteRoom(room.sessionId))
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
  if (maintenanceTimer || state.shuttingDown) return

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
        void queueRoomWrite(room, () => state.store.extendRoom(room.sessionId, new Date(now + PARTY_LIMITS.emptyRoomTtlMs).toISOString()))
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
    messageIds: new Set(),
    messageSizes: [],
    historyBytes: 0,
    emptySinceMs: stored.emptySinceMs,
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
    void queueRoomWrite(room, () => state.store.extendRoom(room.sessionId, new Date(now + PARTY_LIMITS.emptyRoomTtlMs).toISOString()))
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
  const stored = await state.store.findRoom(roomId)
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
    const stored = await state.store.openRoom(
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

/** @internal 테스트용 조회. 저장소 교체는 setPartyChatStore를 사용한다. */
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
