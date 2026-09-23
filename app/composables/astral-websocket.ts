import type {
  AstralWebSocketConnectionStatus,
  AstralWebSocketMessage,
  AstralWebSocketTopic
} from '#shared/types/websocket'
import { onBeforeUnmount, onMounted, readonly, ref, type Ref } from 'vue'

type WsMessageHandler = (message: AstralWebSocketMessage) => void
type WsReconnectHandler = () => void

interface UseAstralWebSocketOptions {
  topics?: AstralWebSocketTopic[]
}

interface WsConsumer {
  status: Ref<AstralWebSocketConnectionStatus>
  clientId: Ref<string | null>
  lastMessageAt: Ref<number | null>
  topics: Set<AstralWebSocketTopic>
  handlers: Map<string, Set<WsMessageHandler>>
  anyHandlers: Set<WsMessageHandler>
  reconnectHandlers: Set<WsReconnectHandler>
}

const consumers = new Set<WsConsumer>()
const topicConsumerCounts = new Map<AstralWebSocketTopic, number>()

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let reconnectAttempt = 0
let hasOpenedOnce = false
let sharedStatus: AstralWebSocketConnectionStatus = 'idle'
let sharedClientId: string | null = null
let sharedLastMessageAt: number | null = null

function updateConsumers(
  updater: (consumer: WsConsumer) => void
): void {
  for (const consumer of consumers) updater(consumer)
}

function setSharedStatus(status: AstralWebSocketConnectionStatus): void {
  sharedStatus = status
  updateConsumers((consumer) => {
    consumer.status.value = status
  })
}

function setSharedClientId(clientId: string | null): void {
  sharedClientId = clientId
  updateConsumers((consumer) => {
    consumer.clientId.value = clientId
  })
}

function setSharedLastMessageAt(timestamp: number): void {
  sharedLastMessageAt = timestamp
  updateConsumers((consumer) => {
    consumer.lastMessageAt.value = timestamp
  })
}

function getWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function isAstralWebSocketMessage(value: unknown): value is AstralWebSocketMessage {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { type?: unknown }).type === 'string'
  )
}

function dispatchMessage(message: AstralWebSocketMessage): void {
  for (const consumer of consumers) {
    for (const handler of consumer.anyHandlers) handler(message)

    const typeHandlers = consumer.handlers.get(message.type)
    if (!typeHandlers) continue
    for (const handler of typeHandlers) handler(message)
  }
}

function clearReconnectTimer(): void {
  if (!reconnectTimer) return
  clearTimeout(reconnectTimer)
  reconnectTimer = undefined
}

function sendTopicControl(
  type: 'WS_SUBSCRIBE' | 'WS_UNSUBSCRIBE',
  topics: AstralWebSocketTopic[]
): void {
  if (topics.length === 0 || socket?.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify({ type, topics }))
}

function addConsumerTopics(topics: Set<AstralWebSocketTopic>): void {
  for (const topic of topics) {
    const currentCount = topicConsumerCounts.get(topic) || 0
    topicConsumerCounts.set(topic, currentCount + 1)
  }

  // A new consumer also needs the topic's snapshot when the socket is already open.
  sendTopicControl('WS_SUBSCRIBE', [...topics])
}

function removeConsumerTopics(topics: Set<AstralWebSocketTopic>): void {
  const inactiveTopics: AstralWebSocketTopic[] = []

  for (const topic of topics) {
    const currentCount = topicConsumerCounts.get(topic) || 0
    if (currentCount <= 1) {
      topicConsumerCounts.delete(topic)
      inactiveTopics.push(topic)
    } else {
      topicConsumerCounts.set(topic, currentCount - 1)
    }
  }

  sendTopicControl('WS_UNSUBSCRIBE', inactiveTopics)
}

function scheduleReconnect(): void {
  if (!import.meta.client || consumers.size === 0 || reconnectTimer) return

  const exponentialDelay = Math.min(1000 * 2 ** reconnectAttempt, 30_000)
  const jitter = Math.floor(Math.random() * 250)
  reconnectAttempt++

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    connectSharedSocket()
  }, exponentialDelay + jitter)
}

function connectSharedSocket(): void {
  if (!import.meta.client || consumers.size === 0) return
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return

  clearReconnectTimer()
  setSharedStatus('connecting')

  const nextSocket = new WebSocket(getWebSocketUrl())
  socket = nextSocket

  nextSocket.addEventListener('open', () => {
    if (socket !== nextSocket) return
    const isReconnect = hasOpenedOnce
    hasOpenedOnce = true
    reconnectAttempt = 0
    setSharedStatus('open')
    sendTopicControl('WS_SUBSCRIBE', [...topicConsumerCounts.keys()])

    if (isReconnect) {
      updateConsumers((consumer) => {
        for (const handler of consumer.reconnectHandlers) handler()
      })
    }
  })

  nextSocket.addEventListener('message', (event) => {
    if (socket !== nextSocket || typeof event.data !== 'string') return

    let message: unknown
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }

    if (!isAstralWebSocketMessage(message)) return

    const now = Date.now()
    setSharedLastMessageAt(now)

    if (message.type === 'WS_PING') {
      if (nextSocket.readyState === WebSocket.OPEN) {
        nextSocket.send(JSON.stringify({ type: 'WS_PONG' }))
      }
      return
    }

    if (message.type === 'WELCOME' && typeof message.clientId === 'string') {
      setSharedClientId(message.clientId)
    }

    dispatchMessage(message)
  })

  nextSocket.addEventListener('error', () => {
    if (socket !== nextSocket) return
    setSharedStatus('error')
  })

  nextSocket.addEventListener('close', () => {
    if (socket !== nextSocket) return
    socket = null
    setSharedClientId(null)
    setSharedStatus('closed')
    scheduleReconnect()
  })
}

function disconnectSharedSocket(): void {
  if (consumers.size > 0) return

  clearReconnectTimer()
  reconnectAttempt = 0
  hasOpenedOnce = false

  const currentSocket = socket
  socket = null
  currentSocket?.close(1000, 'unused')

  sharedClientId = null
  sharedStatus = 'idle'
}

export function useAstralWebSocket(options: UseAstralWebSocketOptions = {}) {
  const status = ref<AstralWebSocketConnectionStatus>(sharedStatus)
  const clientId = ref<string | null>(sharedClientId)
  const lastMessageAt = ref<number | null>(sharedLastMessageAt)
  const topics = new Set(options.topics || [])
  const handlers = new Map<string, Set<WsMessageHandler>>()
  const anyHandlers = new Set<WsMessageHandler>()
  const reconnectHandlers = new Set<WsReconnectHandler>()

  const consumer: WsConsumer = {
    status,
    clientId,
    lastMessageAt,
    topics,
    handlers,
    anyHandlers,
    reconnectHandlers
  }

  function onMessage(type: string, handler: WsMessageHandler): () => void {
    const typeHandlers = handlers.get(type) || new Set<WsMessageHandler>()
    typeHandlers.add(handler)
    handlers.set(type, typeHandlers)

    return () => {
      typeHandlers.delete(handler)
      if (typeHandlers.size === 0) handlers.delete(type)
    }
  }

  function onAnyMessage(handler: WsMessageHandler): () => void {
    anyHandlers.add(handler)
    return () => anyHandlers.delete(handler)
  }

  function onReconnect(handler: WsReconnectHandler): () => void {
    reconnectHandlers.add(handler)
    return () => reconnectHandlers.delete(handler)
  }

  function reconnect(): void {
    if (!import.meta.client) return

    clearReconnectTimer()
    reconnectAttempt = 0

    const currentSocket = socket
    socket = null
    currentSocket?.close(1000, 'manual-reconnect')
    connectSharedSocket()
  }

  onMounted(() => {
    status.value = sharedStatus
    clientId.value = sharedClientId
    lastMessageAt.value = sharedLastMessageAt
    consumers.add(consumer)
    addConsumerTopics(topics)
    connectSharedSocket()
  })

  onBeforeUnmount(() => {
    removeConsumerTopics(topics)
    consumers.delete(consumer)
    handlers.clear()
    anyHandlers.clear()
    reconnectHandlers.clear()
    disconnectSharedSocket()
  })

  return {
    status: readonly(status),
    clientId: readonly(clientId),
    lastMessageAt: readonly(lastMessageAt),
    onMessage,
    onAnyMessage,
    onReconnect,
    reconnect
  }
}
