import type {
  AstralWebSocketMessage,
  AstralWebSocketTopic
} from '#shared/types/websocket'

interface WsPeer {
  id: string
  remoteAddress?: string
  bufferedAmount?: number
  send: (payload: string) => unknown
  close: (code?: number, reason?: string) => unknown
}

interface WsPeerState {
  remoteAddress: string
  lastPongAt: number
  messageWindowStartedAt: number
  messageCount: number
  topics: Set<AstralWebSocketTopic>
}

interface WsConfig {
  maxConnections: number
  maxConnectionsPerIp: number
  maxConnectionAttemptsPerIp: number
  connectionAttemptWindowMs: number
  maxMessagesPerWindow: number
  messageWindowMs: number
  maxMessageBytes: number
  heartbeatIntervalMs: number
  heartbeatTimeoutMs: number
  maxBufferedBytes: number
}

interface ConnectionAttemptState {
  count: number
  windowStartedAt: number
}

const peers = new Map<WsPeer, WsPeerState>()
const activeConnectionsByIp = new Map<string, number>()
const connectionAttempts = new Map<string, ConnectionAttemptState>()

let maintenanceTimer: ReturnType<typeof setInterval> | undefined

function readPositiveInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const wsConfig: Readonly<WsConfig> = Object.freeze({
  maxConnections: readPositiveInt('ASTRAL_WS_MAX_CONNECTIONS', 500),
  maxConnectionsPerIp: readPositiveInt('ASTRAL_WS_MAX_CONNECTIONS_PER_IP', 20),
  maxConnectionAttemptsPerIp: readPositiveInt('ASTRAL_WS_MAX_CONNECTION_ATTEMPTS_PER_IP', 30),
  connectionAttemptWindowMs: readPositiveInt('ASTRAL_WS_CONNECTION_ATTEMPT_WINDOW_MS', 60_000),
  maxMessagesPerWindow: readPositiveInt('ASTRAL_WS_MAX_MESSAGES_PER_WINDOW', 60),
  messageWindowMs: readPositiveInt('ASTRAL_WS_MESSAGE_WINDOW_MS', 60_000),
  maxMessageBytes: readPositiveInt('ASTRAL_WS_MAX_MESSAGE_BYTES', 16 * 1024),
  heartbeatIntervalMs: readPositiveInt('ASTRAL_WS_HEARTBEAT_INTERVAL_MS', 30_000),
  heartbeatTimeoutMs: readPositiveInt('ASTRAL_WS_HEARTBEAT_TIMEOUT_MS', 90_000),
  maxBufferedBytes: readPositiveInt('ASTRAL_WS_MAX_BUFFERED_BYTES', 256 * 1024)
})

export function getWsConfig(): Readonly<WsConfig> {
  return wsConfig
}

function pruneConnectionAttempts(now: number): void {
  for (const [remoteAddress, attempt] of connectionAttempts) {
    if (now - attempt.windowStartedAt >= wsConfig.connectionAttemptWindowMs) {
      connectionAttempts.delete(remoteAddress)
    }
  }
}

function consumeConnectionAttempt(remoteAddress: string, now: number): boolean {
  const current = connectionAttempts.get(remoteAddress)

  if (!current || now - current.windowStartedAt >= wsConfig.connectionAttemptWindowMs) {
    connectionAttempts.set(remoteAddress, {
      count: 1,
      windowStartedAt: now
    })
    return true
  }

  current.count++
  return current.count <= wsConfig.maxConnectionAttemptsPerIp
}

export function canAcceptWsConnection(remoteAddress: string): boolean {
  const now = Date.now()
  pruneConnectionAttempts(now)

  if (!consumeConnectionAttempt(remoteAddress, now)) return false
  if (peers.size >= wsConfig.maxConnections) return false

  const activeConnections = activeConnectionsByIp.get(remoteAddress) || 0
  return activeConnections < wsConfig.maxConnectionsPerIp
}

function startWsMaintenance(): void {
  if (maintenanceTimer || peers.size === 0) return

  maintenanceTimer = setInterval(() => {
    const now = Date.now()
    pruneConnectionAttempts(now)

    for (const [peer, state] of peers) {
      if (now - state.lastPongAt > wsConfig.heartbeatTimeoutMs) {
        closeWsPeer(peer, 1013, 'heartbeat-timeout')
        continue
      }

      try {
        peer.send(JSON.stringify({
          type: 'WS_PING',
          timestamp: now
        }))
      } catch (error) {
        console.error('[ws] Failed to send heartbeat', error)
        closeWsPeer(peer, 1013, 'heartbeat-error')
      }
    }
  }, wsConfig.heartbeatIntervalMs)

  maintenanceTimer.unref?.()
}

function stopWsMaintenanceIfIdle(): void {
  if (peers.size > 0 || !maintenanceTimer) return
  clearInterval(maintenanceTimer)
  maintenanceTimer = undefined
}

export function registerWsPeer(peer: WsPeer, remoteAddress: string): void {
  const now = Date.now()
  peers.set(peer, {
    remoteAddress,
    lastPongAt: now,
    messageWindowStartedAt: now,
    messageCount: 0,
    topics: new Set()
  })
  activeConnectionsByIp.set(remoteAddress, (activeConnectionsByIp.get(remoteAddress) || 0) + 1)
  startWsMaintenance()
}

export function unregisterWsPeer(peer: WsPeer): void {
  const state = peers.get(peer)
  if (!state) return

  peers.delete(peer)

  const activeConnections = activeConnectionsByIp.get(state.remoteAddress) || 0
  if (activeConnections <= 1) {
    activeConnectionsByIp.delete(state.remoteAddress)
  } else {
    activeConnectionsByIp.set(state.remoteAddress, activeConnections - 1)
  }

  stopWsMaintenanceIfIdle()
}

export function markWsPeerPong(peer: WsPeer): void {
  const state = peers.get(peer)
  if (state) state.lastPongAt = Date.now()
}

export function subscribeWsPeer(
  peer: WsPeer,
  topics: AstralWebSocketTopic[]
): void {
  const state = peers.get(peer)
  if (!state) return

  for (const topic of topics) state.topics.add(topic)
}

export function unsubscribeWsPeer(
  peer: WsPeer,
  topics: AstralWebSocketTopic[]
): void {
  const state = peers.get(peer)
  if (!state) return

  for (const topic of topics) state.topics.delete(topic)
}

export function consumeWsMessage(peer: WsPeer): boolean {
  const state = peers.get(peer)
  if (!state) return false

  const now = Date.now()
  if (now - state.messageWindowStartedAt >= wsConfig.messageWindowMs) {
    state.messageWindowStartedAt = now
    state.messageCount = 0
  }

  state.messageCount++
  return state.messageCount <= wsConfig.maxMessagesPerWindow
}

function closeWsPeer(peer: WsPeer, code: number, reason: string): void {
  unregisterWsPeer(peer)

  try {
    peer.close(code, reason)
  } catch (error) {
    console.error(`[ws] Failed to close peer (${reason})`, error)
  }
}

export function broadcastWsMessage(
  message: AstralWebSocketMessage,
  topics: AstralWebSocketTopic | AstralWebSocketTopic[],
  excludeClientId?: string
): number {
  let payload: string

  try {
    payload = JSON.stringify(message)
  } catch (error) {
    console.error('[ws] Failed to serialize broadcast message', error)
    return 0
  }

  const payloadBytes = new TextEncoder().encode(payload).byteLength
  if (payloadBytes > wsConfig.maxMessageBytes) {
    console.error(`[ws] Broadcast message exceeds size limit (${payloadBytes} bytes)`)
    return 0
  }

  let sentCount = 0
  const targetTopics = new Set(Array.isArray(topics) ? topics : [topics])

  for (const [peer, state] of peers) {
    if (excludeClientId && peer.id === excludeClientId) continue
    if (![...targetTopics].some(topic => state.topics.has(topic))) continue

    const bufferedAmount = Number(peer.bufferedAmount || 0)
    if (bufferedAmount > wsConfig.maxBufferedBytes) {
      closeWsPeer(peer, 1013, 'backpressure')
      continue
    }

    try {
      peer.send(payload)
      sentCount++
    } catch (error) {
      console.error('[ws] Failed to broadcast message', error)
      closeWsPeer(peer, 1013, 'broadcast-error')
    }
  }

  return sentCount
}

export function getWsConnectionCount(): number {
  return peers.size
}
