import type {
  PartyErrorServerMessage,
  PartyServerMessage
} from '../../../shared/types/party'
import {
  changePartyCharacter,
  changePartyOrder,
  consumePartyMessage,
  getPartyHistory,
  getPartyRoomPeers,
  joinPartyRoom,
  PARTY_LIMITS,
  recordPartyJoin,
  registerPartyConnection,
  removePartyConnection,
  sendPartyChat,
  setPartyPresenceListener,
  touchPartyConnection,
  type PartyPeer,
  type PartyPresenceUpdate
} from '../../utils/party-chat'

const DEFAULT_SITE_ORIGIN = 'https://astral.maynutlab.com'
const disconnectingPeers = new Set<PartyPeer>()

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>([DEFAULT_SITE_ORIGIN])
  const configuredOrigins = process.env.ASTRAL_WS_ALLOWED_ORIGINS || ''

  for (const value of configuredOrigins.split(',')) {
    const origin = normalizeOrigin(value.trim())
    if (origin) origins.add(origin)
  }

  return origins
}

const allowedOrigins = getAllowedOrigins()

function isLocalDevelopmentOrigin(origin: URL): boolean {
  if (process.env.NODE_ENV === 'production') return false

  return origin.hostname === 'localhost'
    || origin.hostname === '127.0.0.1'
    || origin.hostname === '[::1]'
    || origin.hostname === '::1'
}

function isAllowedOrigin(originHeader: string | null): boolean {
  if (!originHeader) return process.env.NODE_ENV !== 'production'

  try {
    const origin = new URL(originHeader)
    return allowedOrigins.has(origin.origin) || isLocalDevelopmentOrigin(origin)
  } catch {
    return false
  }
}

function getPeerAddress(peer: PartyPeer & { request?: Request }): string {
  if (process.env.ASTRAL_TRUST_PROXY === 'true') {
    return peer.request?.headers.get('x-real-ip')?.trim()
      || peer.remoteAddress
      || 'unknown'
  }

  return peer.remoteAddress || 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getClientMessageId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const normalized = value.trim()
  return normalized.length <= 128 ? normalized : undefined
}

function encodeMessage(message: PartyServerMessage): string | null {
  let payload: string
  try {
    payload = JSON.stringify(message)
  } catch {
    return null
  }

  const payloadBytes = new TextEncoder().encode(payload).byteLength
  return payloadBytes <= PARTY_LIMITS.maxOutgoingMessageBytes ? payload : null
}

function trySend(peer: PartyPeer, message: PartyServerMessage): boolean {
  const payload = encodeMessage(message)
  if (!payload) return false

  const directBufferedAmount = Number(peer.bufferedAmount)
  const websocketBufferedAmount = Number(peer.websocket?.bufferedAmount)
  const bufferedAmount = Number.isFinite(directBufferedAmount)
    ? directBufferedAmount
    : websocketBufferedAmount

  if (bufferedAmount > PARTY_LIMITS.maxBufferedBytes) {
    return false
  }

  try {
    peer.send(payload)
    return true
  } catch {
    return false
  }
}

function broadcastPresence(update: PartyPresenceUpdate): void {
  const messages: PartyServerMessage[] = [
    ...(update.notice ? [{ type: 'LEAVE_NOTICE' as const, notice: update.notice }] : []),
    { type: 'PARTICIPANTS', participants: update.participants }
  ]
  const failedPeers: PartyPeer[] = []

  for (const peer of getPartyRoomPeers(update.roomId)) {
    if (messages.some(message => !trySend(peer, message))) failedPeers.push(peer)
  }

  for (const peer of failedPeers) void disconnectPartyPeer(peer, 1013, 'backpressure')
}

async function disconnectPartyPeer(peer: PartyPeer, code: number, reason: string): Promise<void> {
  if (disconnectingPeers.has(peer)) return

  disconnectingPeers.add(peer)
  const update = await removePartyConnection(peer)
  try {
    peer.close(code, reason)
  } catch {
    // The adapter may already have closed the peer.
  }
  disconnectingPeers.delete(peer)

  if (update) broadcastPresence(update)
}

function sendError(
  peer: PartyPeer,
  code: string,
  message: string,
  clientMessageId?: string
): void {
  const errorMessage: PartyErrorServerMessage = {
    type: 'ERROR',
    code,
    message,
    ...(clientMessageId ? { clientMessageId } : {})
  }

  if (!trySend(peer, errorMessage)) {
    void disconnectPartyPeer(peer, 1013, 'backpressure')
  }
}

async function handleJoin(peer: PartyPeer, data: Record<string, unknown>): Promise<void> {
  let result: Awaited<ReturnType<typeof joinPartyRoom>>
  try {
    result = await joinPartyRoom(peer, {
      roomId: data.roomId,
      nickname: data.nickname,
      characterId: data.characterId,
      order: data.order
    })
  } catch (error) {
    console.error('[ws/party] Failed to join room', error)
    sendError(peer, 'STORAGE_UNAVAILABLE', '채팅방 기록에 연결하지 못했습니다. 다시 시도해 주세요.')
    return
  }

  if (!result.ok) {
    sendError(peer, result.code, result.message)
    return
  }

  const joined: PartyServerMessage = {
    type: 'JOINED',
    sessionId: result.sessionId,
    participantId: result.participantId,
    room: result.room,
    messages: result.messages,
    participants: result.participants
  }

  if (!trySend(peer, joined)) {
    void disconnectPartyPeer(peer, 1013, 'backpressure')
    return
  }

  broadcastPresence({
    roomId: result.room.roomId,
    participants: result.participants
  })

  let entry: Awaited<ReturnType<typeof recordPartyJoin>>
  try {
    entry = await recordPartyJoin(peer)
  } catch (error) {
    console.error('[ws/party] Failed to save join notice', error)
    return
  }
  if (entry) {
    const notice: PartyServerMessage = { type: 'JOIN_NOTICE', notice: entry.notice }
    const failedPeers: PartyPeer[] = []
    for (const target of entry.peers) {
      if (!trySend(target, notice)) failedPeers.push(target)
    }
    for (const target of failedPeers) void disconnectPartyPeer(target, 1013, 'backpressure')
  }
}

async function handleChat(peer: PartyPeer, data: Record<string, unknown>): Promise<void> {
  let result: Awaited<ReturnType<typeof sendPartyChat>>
  try {
    result = await sendPartyChat(peer, {
      text: data.text,
      clientMessageId: data.clientMessageId
    })
  } catch (error) {
    console.error('[ws/party] Failed to save chat message', error)
    sendError(peer, 'STORAGE_UNAVAILABLE', '메시지를 저장하지 못했습니다. 다시 시도해 주세요.', getClientMessageId(data.clientMessageId))
    return
  }

  if (!result.ok) {
    sendError(peer, result.code, result.message, getClientMessageId(data.clientMessageId))
    return
  }

  const message: PartyServerMessage = {
    type: 'CHAT',
    message: result.message
  }
  const failedPeers: PartyPeer[] = []

  for (const target of result.peers) {
    if (!trySend(target, message)) failedPeers.push(target)
  }

  for (const target of failedPeers) void disconnectPartyPeer(target, 1013, 'backpressure')
}

setPartyPresenceListener(broadcastPresence)

export default defineWebSocketHandler({
  upgrade(request) {
    if (!isAllowedOrigin(request.headers.get('origin'))) {
      return new Response('WebSocket origin is not allowed.', { status: 403 })
    }
  },

  open(peer) {
    const partyPeer = peer as PartyPeer & { request?: Request }
    if (!registerPartyConnection(partyPeer, getPeerAddress(partyPeer))) {
      partyPeer.close(1013, 'connection-limit')
      return
    }
    partyPeer.websocket?.on?.('pong', () => touchPartyConnection(partyPeer))
  },

  async message(peer, message) {
    const partyPeer = peer as PartyPeer
    const text = message.text()
    const messageBytes = new TextEncoder().encode(text).byteLength

    if (messageBytes > PARTY_LIMITS.maxIncomingMessageBytes) {
      await disconnectPartyPeer(partyPeer, 1009, 'message-too-large')
      return
    }

    if (!consumePartyMessage(partyPeer)) {
      await disconnectPartyPeer(partyPeer, 1013, 'message-rate-limit')
      return
    }

    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      sendError(partyPeer, 'INVALID_JSON', '메시지는 올바른 JSON이어야 합니다.')
      await disconnectPartyPeer(partyPeer, 1003, 'invalid-json')
      return
    }

    if (!isRecord(data) || typeof data.type !== 'string') {
      sendError(partyPeer, 'INVALID_MESSAGE', '메시지는 type을 포함한 JSON 객체여야 합니다.')
      return
    }

    switch (data.type) {
      case 'JOIN':
        await handleJoin(partyPeer, data)
        return
      case 'CHAT':
        await handleChat(partyPeer, data)
        return
      case 'SET_CHARACTER': {
        let result: Awaited<ReturnType<typeof changePartyCharacter>>
        try {
          result = await changePartyCharacter(partyPeer, data.characterId)
        } catch (error) {
          console.error('[ws/party] Failed to change character', error)
          sendError(partyPeer, 'STORAGE_UNAVAILABLE', '캐릭터 변경을 저장하지 못했습니다. 다시 시도해 주세요.')
          return
        }
        if (!result.ok) sendError(partyPeer, result.code, result.message)
        else broadcastPresence({ roomId: result.roomId, participants: result.participants })
        return
      }
      case 'SET_ORDER': {
        let result: Awaited<ReturnType<typeof changePartyOrder>>
        try {
          result = await changePartyOrder(partyPeer, data.order)
        } catch (error) {
          console.error('[ws/party] Failed to change order', error)
          sendError(partyPeer, 'STORAGE_UNAVAILABLE', '순서 변경을 저장하지 못했습니다. 다시 시도해 주세요.')
          return
        }
        if (!result.ok) sendError(partyPeer, result.code, result.message)
        else broadcastPresence({ roomId: result.roomId, participants: result.participants })
        return
      }
      case 'HISTORY': {
        try {
          const result = await getPartyHistory(partyPeer, data.before)
          if ('ok' in result) sendError(partyPeer, result.code, result.message)
          else if (!trySend(partyPeer, { type: 'HISTORY', ...result })) {
            await disconnectPartyPeer(partyPeer, 1013, 'backpressure')
          }
        } catch (error) {
          console.error('[ws/party] Failed to load history', error)
          sendError(partyPeer, 'HISTORY_UNAVAILABLE', '이전 대화를 불러오지 못했습니다. 다시 시도해 주세요.')
        }
        return
      }
      case 'PING':
        touchPartyConnection(partyPeer)
        if (!trySend(partyPeer, { type: 'PONG' })) {
          await disconnectPartyPeer(partyPeer, 1013, 'backpressure')
        }
        return
      default:
        sendError(partyPeer, 'UNSUPPORTED_MESSAGE', '지원하지 않는 메시지 형식입니다.')
    }
  },

  async close(peer) {
    const update = await removePartyConnection(peer as PartyPeer)
    if (update) broadcastPresence(update)
  },

  pong(peer) {
    touchPartyConnection(peer as PartyPeer)
  },

  async error(peer, error) {
    console.error(`[ws/party] Peer error: ${peer.id}`, error)
    const update = await removePartyConnection(peer as PartyPeer)
    if (update) broadcastPresence(update)
  }
})
