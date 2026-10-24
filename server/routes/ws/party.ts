import {
  parsePartyClientMessage,
  type PartyClientMessageInput,
  type PartyErrorServerMessage,
  type PartyServerMessage
} from '../../../shared/types/party'
import {
  changePartyCharacter,
  changePartyOrder,
  consumePartyMessage,
  getPartyHistory,
  getPartyRoomPeers,
  joinPartyRoom,
  recordPartyJoin,
  registerPartyConnection,
  removePartyConnection,
  sendPartyChat,
  setPartyPresenceListener,
  touchPartyConnection
} from '../../utils/party-chat'
import { PARTY_LIMITS } from '../../utils/party-chat-limits'
import type { PartyPeer, PartyPresenceUpdate } from '../../utils/party-chat-types'
import { getTrustedClientIp, isAllowedWebSocketOrigin } from '../../utils/ws-origin'

const disconnectingPeers = new Set<PartyPeer>()

function getClientMessageId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const normalized = value.trim()
  return normalized.length <= PARTY_LIMITS.maxClientMessageIdLength ? normalized : undefined
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

  return trySendPayload(peer, payload)
}

function trySendPayload(peer: PartyPeer, payload: string): boolean {
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

function broadcastMessages(peers: PartyPeer[], messages: PartyServerMessage[]): void {
  const payloads = messages.map(encodeMessage)
  const failedPeers: PartyPeer[] = []
  for (const peer of peers) {
    if (payloads.some(payload => !payload || !trySendPayload(peer, payload))) failedPeers.push(peer)
  }
  for (const peer of failedPeers) void disconnectPartyPeer(peer, 1013, 'backpressure')
}

function broadcastPresence(update: PartyPresenceUpdate): void {
  const messages: PartyServerMessage[] = [
    ...(update.notice ? [{ type: 'LEAVE_NOTICE' as const, notice: update.notice }] : []),
    ...(update.participants ? [{ type: 'PARTICIPANTS' as const, participants: update.participants }] : [])
  ]
  broadcastMessages(getPartyRoomPeers(update.roomId), messages)
}

// removePartyConnection이 presence를 직접 발행하므로 여기서는 소켓만 닫는다.
async function disconnectPartyPeer(peer: PartyPeer, code: number, reason: string): Promise<void> {
  if (disconnectingPeers.has(peer)) return

  disconnectingPeers.add(peer)
  try {
    const removal = removePartyConnection(peer, Date.now(), { code, reason, serverReason: reason })
    try {
      peer.close(code, reason)
    } catch {
      // The adapter may already have closed the peer.
    }
    await removal
  } finally {
    disconnectingPeers.delete(peer)
  }
}

function sendError(
  peer: PartyPeer,
  code: string,
  message: string,
  clientMessageId?: string,
  retryAfterMs?: number
): void {
  const errorMessage: PartyErrorServerMessage = {
    type: 'ERROR',
    code,
    message,
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs })
  }

  if (!trySend(peer, errorMessage)) {
    void disconnectPartyPeer(peer, 1013, 'backpressure')
  }
}

async function handleJoin(peer: PartyPeer, data: Extract<PartyClientMessageInput, { type: 'JOIN' }>): Promise<void> {
  let result: Awaited<ReturnType<typeof joinPartyRoom>>
  try {
    result = await joinPartyRoom(peer, {
      roomId: data.roomId,
      nickname: data.nickname,
      characterId: data.characterId,
      order: data.order,
      reconnectToken: data.reconnectToken,
      diagnostics: data.diagnostics
    })
  } catch (error) {
    console.error('[ws/party] Failed to join room', error)
    sendError(peer, 'STORAGE_UNAVAILABLE', '채팅방 기록에 연결하지 못했습니다. 다시 시도해 주세요.')
    return
  }

  if (!result.ok) {
    sendError(peer, result.code, result.message, undefined, result.retryAfterMs)
    return
  }

  const joined: PartyServerMessage = {
    type: 'JOINED',
    sessionId: result.sessionId,
    participantId: result.participantId,
    reconnectToken: result.reconnectToken,
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

  const entry = recordPartyJoin(peer)
  if (entry) broadcastMessages(entry.peers, [{ type: 'JOIN_NOTICE', notice: entry.notice }])
}

async function handleChat(peer: PartyPeer, data: Extract<PartyClientMessageInput, { type: 'CHAT' }>): Promise<void> {
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
  broadcastMessages(result.peers, [message])
}

setPartyPresenceListener(broadcastPresence)

export default defineWebSocketHandler({
  upgrade(request) {
    if (!isAllowedWebSocketOrigin(request.headers.get('origin'))) {
      return new Response('WebSocket origin is not allowed.', { status: 403 })
    }
  },

  open(peer) {
    const partyPeer = peer as PartyPeer & { request?: Request }
    if (!registerPartyConnection(partyPeer, getTrustedClientIp(partyPeer.request?.headers.get('x-real-ip'), partyPeer.remoteAddress))) {
      void disconnectPartyPeer(partyPeer, 1013, 'connection-limit')
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

    const parsed = parsePartyClientMessage(data)
    if (!parsed.ok) {
      sendError(partyPeer, parsed.code, parsed.message)
      return
    }
    const input = parsed.message

    switch (input.type) {
      case 'JOIN':
        await handleJoin(partyPeer, input)
        return
      case 'CHAT':
        await handleChat(partyPeer, input)
        return
      case 'SET_CHARACTER': {
        let result: Awaited<ReturnType<typeof changePartyCharacter>>
        try {
          result = await changePartyCharacter(partyPeer, input.characterId)
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
          result = await changePartyOrder(partyPeer, input.order)
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
          const result = await getPartyHistory(partyPeer, input.before)
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
    }
  },

  async close(peer, details) {
    await removePartyConnection(peer as PartyPeer, Date.now(), details ?? {})
  },

  async error(peer, error) {
    console.error(`[ws/party] Peer error: ${peer.id}`, error)
    await removePartyConnection(peer as PartyPeer, Date.now(), 'loss')
  }
})
