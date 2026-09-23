import { randomUUID } from 'node:crypto'
import {
  PARTY_CHARACTER_IDS,
  PARTY_HISTORY_MAX_BYTES,
  PARTY_HISTORY_MAX_MESSAGES,
  PARTY_ORDERS,
  PARTY_ROOM_ID_PATTERN,
  PARTY_SPECTATOR_ID,
  type PartyCharacterId,
  type PartyChatMessage,
  type PartyJoinNotice,
  type PartyLeaveNotice,
  type PartyParticipant,
  type PartyOrder,
  type PartyRoomMessage,
  type PartyRoomSummary
} from '../../shared/types/party.ts'
import { postgresPartyChatStore, type PartyChatStore } from './party-chat-storage.ts'

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
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 90_000,
  maxNicknameLength: 20,
  maxTextLength: 1_000,
  maxClientMessageIdLength: 128,
  historyLimit: PARTY_HISTORY_MAX_MESSAGES,
  historyMaxBytes: PARTY_HISTORY_MAX_BYTES
})

const HEARTBEAT_PING_PAYLOAD = 'party-presence'

export interface PartyPeer {
  id: string
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
  room?: PartyRoom
  participant?: PartyParticipant
}

interface PartyRoom {
  roomId: string
  sessionId: string
  createdAt: string
  participants: Map<PartyPeer, PartyConnection>
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

export interface PartyLeaveResult {
  roomId: string
  participants: PartyParticipant[]
  notice: PartyLeaveNotice
}

export interface PartyPresenceUpdate {
  roomId: string
  participants: PartyParticipant[]
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
}

export interface PartyJoinSuccess {
  ok: true
  sessionId: string
  participantId: string
  room: PartyRoomSummary
  messages: PartyRoomMessage[]
  participants: PartyParticipant[]
}

export interface PartyJoinFailure {
  ok: false
  code: string
  message: string
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

export function setPartyChatStore(store: PartyChatStore): void {
  partyChatStore = store
}

export function getRetainedPartySessionIds(): string[] {
  return [...rooms.values()].map(room => room.sessionId)
}

function getTextLength(value: string): number {
  return Array.from(value).length
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

export function isPartyNicknameTaken(roomId: string, nickname: string): boolean {
  const room = rooms.get(roomId)
  if (!room) return false

  const key = nicknameKey(nickname)
  return [...room.participants.values()]
    .some(connection => connection.participant && nicknameKey(connection.participant.nickname) === key)
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
    && (value === PARTY_SPECTATOR_ID || PARTY_CHARACTER_IDS.some(id => id === value))
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
  const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8') + 1
  room.messages.push(message)
  room.messageSizes.push(bytes)
  room.historyBytes += bytes
  trimRoomHistory(room)
}

function queueRoomWrite<T>(room: PartyRoom, operation: () => Promise<T>): Promise<T> {
  const result = room.writeQueue.then(operation)
  room.writeQueue = result.then(() => undefined, () => undefined)
  return result
}

function persistRoomMessage(room: PartyRoom, message: PartyRoomMessage): Promise<void> {
  return queueRoomWrite(room, async () => {
    await partyChatStore.appendMessage(room.sessionId, message)
    appendRoomMessage(room, message)
  })
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

function consumeJoinAttempt(ipAddress: string, now: number): boolean {
  const current = joinAttemptsByIp.get(ipAddress)

  if (!current || now - current.windowStartedAt >= PARTY_LIMITS.joinAttemptWindowMs) {
    joinAttemptsByIp.set(ipAddress, {
      count: 1,
      windowStartedAt: now
    })
    return true
  }

  current.count++
  return current.count <= PARTY_LIMITS.maxJoinAttemptsPerIp
}

function setEmptySince(room: PartyRoom, now: number): void {
  room.emptySinceMs = room.participants.size === 0
    ? now
    : null
}

function pruneEmptyRooms(now: number): void {
  for (const [roomId, room] of rooms) {
    if (
      room.participants.size === 0
      && room.emptySinceMs !== null
      && now - room.emptySinceMs >= PARTY_LIMITS.emptyRoomTtlMs
    ) {
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
  if (maintenanceTimer) return

  maintenanceTimer = setInterval(() => {
    const now = Date.now()
    pruneJoinAttempts(now)

    for (const connection of [...connections.values()]) {
      if (now - connection.lastSeenAt <= PARTY_LIMITS.heartbeatTimeoutMs) continue

      void removePartyConnection(connection.peer, now).then((update) => {
        if (update) presenceListener?.(update)
      }).catch(error => console.error('[party] Failed to remove stale peer', error))
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
        void removePartyConnection(connection.peer, now).then((update) => {
          if (update) presenceListener?.(update)
        }).catch(error => console.error('[party] Failed to remove peer', error))
        try {
          connection.peer.close(1013, 'heartbeat-error')
        } catch {
          // The adapter may already have closed the peer.
        }
      }
    }

    for (const room of rooms.values()) {
      if (room.participants.size > 0) {
        void partyChatStore.extendRoom(room.sessionId, new Date(now + PARTY_LIMITS.emptyRoomTtlMs).toISOString())
          .catch(error => console.error('[party] Failed to renew room', error))
      }
    }

    pruneEmptyRooms(now)
    maybeStopMaintenance()
  }, PARTY_LIMITS.heartbeatIntervalMs)

  maintenanceTimer.unref?.()
}

function hydrateRoom(roomId: string, stored: Awaited<ReturnType<PartyChatStore['openRoom']>>): PartyRoom {
  const room: PartyRoom = {
    roomId,
    sessionId: stored.sessionId,
    createdAt: stored.createdAt,
    participants: new Map(),
    messages: [],
    messageSizes: [],
    historyBytes: 0,
    emptySinceMs: Date.parse(stored.expiresAt) - PARTY_LIMITS.emptyRoomTtlMs,
    writeQueue: Promise.resolve()
  }
  for (const message of stored.messages) appendRoomMessage(room, message)
  rooms.set(roomId, room)
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
  return rooms.get(roomId) ?? hydrateRoom(roomId, stored)
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
    const stored = await partyChatStore.openRoom(
      roomId,
      randomUUID(),
      new Date(createdAtMs).toISOString(),
      new Date(createdAtMs + PARTY_LIMITS.emptyRoomTtlMs).toISOString()
    )
    const room = rooms.get(roomId) ?? hydrateRoom(roomId, stored)
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
    closed: false
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

export async function joinPartyRoom(
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

  if (connection.room || connection.participant) {
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

  const now = Date.now()
  if (!consumeJoinAttempt(connection.ipAddress, now)) {
    return {
      ok: false,
      code: 'JOIN_RATE_LIMITED',
      message: '입장 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    }
  }

  const room = await findPartyRoom(roomId)
  if (!room) {
    return {
      ok: false,
      code: 'ROOM_NOT_FOUND',
      message: '방을 찾을 수 없습니다.'
    }
  }

  if (isPartyNicknameTaken(roomId, nickname)) {
    return {
      ok: false,
      code: 'NICKNAME_TAKEN',
      message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.'
    }
  }

  const participant: PartyParticipant = {
    id: randomUUID(),
    nickname,
    characterId: input.characterId,
    order: input.characterId === PARTY_SPECTATOR_ID ? null : (input.order ?? PARTY_ORDERS[0]) as PartyOrder
  }
  const admitted = await queueRoomWrite(room, async () => {
    if (isPartyNicknameTaken(roomId, nickname) || connection.closed) return false
    await partyChatStore.addParticipant(room.sessionId, participant)
    await partyChatStore.extendRoom(room.sessionId, new Date(Date.now() + PARTY_LIMITS.emptyRoomTtlMs).toISOString())
    if (connection.closed) return false
    connection.room = room
    connection.participant = participant
    room.participants.set(peer, connection)
    setEmptySince(room, Date.now())
    return true
  })
  if (!admitted) {
    return connection.closed
      ? { ok: false, code: 'CONNECTION_CLOSED', message: '웹소켓 연결을 사용할 수 없습니다.' }
      : { ok: false, code: 'NICKNAME_TAKEN', message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.' }
  }

  return {
    ok: true,
    sessionId: room.sessionId,
    participantId: participant.id,
    room: getRoomSummary(room),
    messages: room.messages.map(cloneMessage),
    participants: getParticipants(room)
  }
}

export async function recordPartyJoin(peer: PartyPeer): Promise<{ notice: PartyJoinNotice, peers: PartyPeer[] } | null> {
  const connection = connections.get(peer)
  if (!connection || connection.closed || !connection.room || !connection.participant) return null

  const notice: PartyJoinNotice = {
    kind: 'join',
    id: randomUUID(),
    nickname: connection.participant.nickname,
    createdAt: new Date().toISOString()
  }
  await persistRoomMessage(connection.room, notice)
  return { notice: { ...notice }, peers: [...connection.room.participants.keys()] }
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
  const updated = cloneParticipant(connection.participant)
  updated.characterId = characterId
  if (characterId === PARTY_SPECTATOR_ID) updated.order = null
  else if (!updated.order) updated.order = PARTY_ORDERS[0]
  await queueRoomWrite(connection.room, () => partyChatStore.updateParticipant(updated))
  connection.participant.characterId = updated.characterId
  connection.participant.order = updated.order
  syncParticipantMessages(connection.room, connection.participant)

  return {
    ok: true,
    roomId: connection.room.roomId,
    participants: getParticipants(connection.room)
  }
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
  const updated = { ...connection.participant, order }
  await queueRoomWrite(connection.room, () => partyChatStore.updateParticipant(updated))
  connection.participant.order = order
  syncParticipantMessages(connection.room, connection.participant)
  return {
    ok: true,
    roomId: connection.room.roomId,
    participants: getParticipants(connection.room)
  }
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
  const createdAt = new Date(connection.lastSeenAt).toISOString()
  const message: PartyChatMessage = {
    kind: 'chat',
    id: randomUUID(),
    clientMessageId: clientMessageId || randomUUID(),
    participant: cloneParticipant(connection.participant),
    text,
    createdAt
  }

  const room = connection.room
  await persistRoomMessage(room, message)

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

export async function removePartyConnection(
  peer: PartyPeer,
  now = Date.now()
): Promise<PartyLeaveResult | null> {
  const connection = connections.get(peer)
  if (!connection) return null

  connection.closed = true
  connections.delete(peer)

  const activeForIp = activeConnectionsByIp.get(connection.ipAddress) || 0
  if (activeForIp <= 1) {
    activeConnectionsByIp.delete(connection.ipAddress)
  } else {
    activeConnectionsByIp.set(connection.ipAddress, activeForIp - 1)
  }

  const room = connection.room
  const roomId = room?.roomId
  if (!room || !roomId || !connection.participant) {
    maybeStopMaintenance()
    return null
  }

  room.participants.delete(peer)
  const notice: PartyLeaveNotice = {
    kind: 'leave',
    id: randomUUID(),
    nickname: connection.participant.nickname,
    createdAt: new Date(now).toISOString()
  }
  connection.room = undefined
  connection.participant = undefined
  setEmptySince(room, now)
  try {
    await persistRoomMessage(room, notice)
    await queueRoomWrite(room, async () => {
      if (room.participants.size === 0) {
        await partyChatStore.setRoomExpiry(room.sessionId, new Date(now + PARTY_LIMITS.emptyRoomTtlMs).toISOString())
      }
    })
  } catch (error) {
    console.error('[party] Failed to save leave notice', error)
  }
  maybeStopMaintenance()

  return {
    roomId,
    participants: getParticipants(room),
    notice: { ...notice }
  }
}

export function setPartyPresenceListener(
  listener: ((update: PartyPresenceUpdate) => void) | undefined
): void {
  presenceListener = listener
}
