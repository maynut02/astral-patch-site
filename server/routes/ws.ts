import {
  ASTRAL_WS_TOPICS,
  type AstralWebSocketMessage,
  type AstralWebSocketTopic
} from '#shared/types/websocket'
import {
  canAcceptWsConnection,
  consumeWsMessage,
  getWsConfig,
  markWsPeerPong,
  registerWsPeer,
  subscribeWsPeer,
  unsubscribeWsPeer,
  unregisterWsPeer
} from '../utils/ws-hub'

const DEFAULT_SITE_ORIGIN = 'https://astral.maynutlab.com'

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
const allowedTopics = new Set<string>(ASTRAL_WS_TOPICS)

function readTopics(value: unknown): AstralWebSocketTopic[] | null {
  if (!Array.isArray(value) || value.length === 0) return null

  const topics = [...new Set(value)]
  if (topics.some(topic => typeof topic !== 'string' || !allowedTopics.has(topic))) {
    return null
  }

  return topics as AstralWebSocketTopic[]
}

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

export default defineWebSocketHandler({
  upgrade(request) {
    if (!isAllowedOrigin(request.headers.get('origin'))) {
      return new Response('WebSocket origin is not allowed.', { status: 403 })
    }
  },

  open(peer) {
    const remoteAddress = peer.remoteAddress || 'unknown'
    if (!canAcceptWsConnection(remoteAddress)) {
      peer.close(1013, 'connection-limit')
      return
    }

    registerWsPeer(peer, remoteAddress)
    peer.send(JSON.stringify({
      type: 'WELCOME',
      clientId: peer.id
    }))
  },

  message(peer, message) {
    const text = message.text()
    const messageBytes = new TextEncoder().encode(text).byteLength

    if (messageBytes > getWsConfig().maxMessageBytes) {
      unregisterWsPeer(peer)
      peer.close(1009, 'message-too-large')
      return
    }

    if (!consumeWsMessage(peer)) {
      unregisterWsPeer(peer)
      peer.close(1013, 'message-rate-limit')
      return
    }

    let eventData: AstralWebSocketMessage
    try {
      eventData = JSON.parse(text) as AstralWebSocketMessage
    } catch {
      unregisterWsPeer(peer)
      peer.close(1003, 'invalid-json')
      return
    }

    if (eventData?.type === 'WS_PONG') {
      markWsPeerPong(peer)
      return
    }

    if (eventData?.type === 'WS_SUBSCRIBE' || eventData?.type === 'WS_UNSUBSCRIBE') {
      const topics = readTopics(eventData.topics)
      if (!topics) {
        unregisterWsPeer(peer)
        peer.close(1008, 'invalid-topics')
        return
      }

      if (eventData.type === 'WS_SUBSCRIBE') {
        subscribeWsPeer(peer, topics)
      } else {
        unsubscribeWsPeer(peer, topics)
      }
      return
    }

    unregisterWsPeer(peer)
    peer.close(1008, 'unsupported-message')
  },

  close(peer) {
    unregisterWsPeer(peer)
  },

  error(peer, error) {
    console.error(`[ws] Peer error: ${peer.id}`, error)
    unregisterWsPeer(peer)
  }
})
