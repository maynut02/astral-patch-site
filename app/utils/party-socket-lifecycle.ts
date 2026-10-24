import type { Ref } from 'vue'
import { PARTY_CLOSE_PAGE_HIDE, PARTY_CLOSE_UNRESPONSIVE_CODE, type PartyCharacterId, type PartyConnectionDiagnostics, type PartyOrder, type PartyServerMessage } from '#shared/types/party'
import { encodePartyClientMessage, isPartyServerMessage } from '~/utils/party-wire'

export interface PartyCredentials {
  nickname: string
  characterId: PartyCharacterId
  order: PartyOrder | null
}

const LIVENESS_TIMEOUT_MS = 5_000

export interface PartySocketState {
  socket?: WebSocket
  credentials?: PartyCredentials
  reconnectTimer?: ReturnType<typeof setTimeout>
  heartbeatTimer?: ReturnType<typeof setInterval>
  connectionTimer?: ReturnType<typeof setTimeout>
  livenessTimer?: ReturnType<typeof setTimeout>
  stopped: boolean
  disposed: boolean
  attempt: number
  connectionAttempt: number
  firstJoin: boolean
  lastClosedAt?: number
  lastCloseDiagnostics: PartyConnectionDiagnostics
  unansweredPings: number
  lastReceivedAt: number
  retryNotBefore: number
  pageHidden: boolean
  autoReconnectSuspended: boolean
}

export function createPartySocketState(): PartySocketState {
  return { stopped: false, disposed: false, attempt: 0, connectionAttempt: 0, firstJoin: true, lastCloseDiagnostics: {}, unansweredPings: 0, lastReceivedAt: 0, retryNotBefore: 0, pageHidden: false, autoReconnectSuspended: false }
}

interface PartySocketHandlers {
  status: Ref<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'>
  error: Ref<string>
  joined: Ref<boolean>
  clearHistoryTimer: () => void
  clearResumeContext: () => void
  disconnected: () => void
  failPendingMessages: (reason: string) => void
  message: (message: PartyServerMessage, socket: WebSocket) => void
}

export function createPartySocketLifecycle(roomId: string, socketState: PartySocketState, getReconnectToken: () => string | undefined, handlers: PartySocketHandlers) {
  const { status, error, joined } = handlers

  function clearTimers() {
    clearTimeout(socketState.reconnectTimer)
    clearTimeout(socketState.connectionTimer)
    clearInterval(socketState.heartbeatTimer)
    clearTimeout(socketState.livenessTimer)
    handlers.clearHistoryTimer()
    socketState.reconnectTimer = undefined
    socketState.connectionTimer = undefined
    socketState.heartbeatTimer = undefined
    socketState.livenessTimer = undefined
  }

  function scheduleReconnect() {
    if (socketState.stopped || socketState.disposed || !socketState.credentials || socketState.autoReconnectSuspended) return
    clearTimers()
    const baseDelay = Math.min(1000 * 2 ** socketState.attempt++, 5000)
    const jitter = Math.floor(Math.random() * 300)
    // 서버가 알려준 재시도 시각은 지수 백오프보다 우선한다.
    const cooldownDelay = Math.max(0, socketState.retryNotBefore - Date.now())
    socketState.reconnectTimer = setTimeout(connect, Math.max(baseDelay + jitter, cooldownDelay))
  }

  function connect() {
    if (socketState.stopped || socketState.disposed || !socketState.credentials) return
    clearTimers()
    status.value = joined.value ? 'reconnecting' : 'connecting'
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/party`)
    socketState.connectionAttempt++
    socketState.socket = ws
    socketState.connectionTimer = setTimeout(() => abandonSocket(ws, 'join-timeout'), 20_000)
    ws.onopen = () => {
      if (socketState.socket !== ws || socketState.stopped || socketState.disposed || !socketState.credentials) return
      socketState.unansweredPings = 0
      socketState.lastReceivedAt = Date.now()
      const navigation = socketState.firstJoin && typeof performance !== 'undefined'
        ? performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        : undefined
      const diagnostics: PartyConnectionDiagnostics = {
        attempt: socketState.connectionAttempt,
        ...socketState.lastCloseDiagnostics,
        ...(socketState.lastClosedAt !== undefined ? { lastCloseAgoMs: Date.now() - socketState.lastClosedAt } : {}),
        ...(navigation?.type ? { navigationType: navigation.type } : {})
      }
      socketState.firstJoin = false
      ws.send(encodePartyClientMessage({
        type: 'JOIN',
        roomId,
        ...socketState.credentials,
        ...(getReconnectToken() ? { reconnectToken: getReconnectToken() } : {}),
        diagnostics
      }))
      socketState.heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        const now = Date.now()
        if (socketState.unansweredPings >= 2 && now - socketState.lastReceivedAt >= 55_000) {
          abandonSocket(ws, 'heartbeat-timeout')
          return
        }
        ws.send(encodePartyClientMessage({ type: 'PING' }))
        socketState.unansweredPings++
      }, 20_000)
    }
    ws.onmessage = (event) => {
      if (socketState.socket !== ws || socketState.stopped || socketState.disposed || !socketState.credentials) return
      socketState.unansweredPings = 0
      socketState.lastReceivedAt = Date.now()
      let data: unknown
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }
      if (!isPartyServerMessage(data)) {
        console.warn('[party] Invalid server message')
        return
      }
      handlers.message(data, ws)
    }
    ws.onerror = () => { /* The close handler retries failed connections. */ }
    ws.onclose = event => handleSocketClosed(ws, event)
  }

  function handleSocketClosed(ws: WebSocket, event: { code?: number, reason?: string } | undefined) {
    socketState.lastClosedAt = Date.now()
    socketState.lastCloseDiagnostics = {
      ...(typeof event?.code === 'number' ? { lastCloseCode: event.code } : {}),
      ...(typeof event?.reason === 'string' ? { lastCloseReason: event.reason } : {}),
      ...(typeof document !== 'undefined' ? { hiddenAtClose: document.visibilityState === 'hidden' } : {}),
      ...(typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? { onlineAtClose: navigator.onLine } : {})
    }
    if (socketState.socket !== ws || socketState.stopped || socketState.disposed) return
    if (event?.reason === 'replaced-by-reconnect') {
      // 다른 탭이 같은 세션을 이어받았으므로 이 탭은 물러나고 재개 수단을 정리한다.
      handlers.clearResumeContext()
      socketState.autoReconnectSuspended = true
      status.value = 'error'
      error.value = '다른 탭에서 이 채팅방에 다시 연결했습니다. 이 탭에서 계속하려면 다시 입장해 주세요.'
      clearTimers()
      return
    }
    handlers.failPendingMessages('연결이 끊겨 전송 결과를 확인하지 못했습니다. 다시 연결되면 자동으로 재전송합니다.')
    clearTimers()
    handlers.disconnected()
    // 자동 재시도를 멈춘 상태라면 종료 원인이 된 입장 오류 화면을 덮어쓰지 않는다.
    if (socketState.autoReconnectSuspended) return
    status.value = 'reconnecting'
    // 입장 오류로 이미 안내 문구가 있으면 그 원인을 유지한다.
    if (!error.value) error.value = '연결이 끊어졌습니다. 자동으로 다시 연결하고 있습니다.'
    scheduleReconnect()
  }

  // 응답 없는 소켓에 close()를 부르면 브라우저는 서버의 종료 확인을 기다린다(Chromium 최대 60초).
  // 그동안 onclose가 오지 않아 재연결이 묶이므로, 핸들러를 떼고 바로 끊긴 것으로 처리한다.
  function abandonSocket(ws: WebSocket, reason: string) {
    ws.onopen = null
    ws.onmessage = null
    ws.onerror = null
    ws.onclose = null
    try {
      ws.close(PARTY_CLOSE_UNRESPONSIVE_CODE, reason)
    } catch {
      // The socket may already be closed.
    }
    handleSocketClosed(ws, { code: PARTY_CLOSE_UNRESPONSIVE_CODE, reason })
  }

  function handleVisibilityOrOnline() {
    if (socketState.disposed || socketState.stopped || !socketState.credentials || socketState.autoReconnectSuspended) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    const current = socketState.socket
    if (current?.readyState === WebSocket.OPEN) {
      // 백그라운드에서 이미 죽은 소켓도 OPEN으로 남는다. heartbeat가 알아채기까지 1분 넘게 기다리지 않도록 바로 확인한다.
      const probeStartedAt = Date.now()
      try {
        current.send(encodePartyClientMessage({ type: 'PING' }))
      } catch {
        abandonSocket(current, 'liveness-timeout')
        return
      }
      if (socketState.livenessTimer) return
      socketState.livenessTimer = setTimeout(() => {
        socketState.livenessTimer = undefined
        if (socketState.socket !== current || socketState.lastReceivedAt >= probeStartedAt) return
        abandonSocket(current, 'liveness-timeout')
      }, LIVENESS_TIMEOUT_MS)
      return
    }

    // 서버가 정한 재시도 시각 전에는 가시성/온라인 이벤트로도 앞당기지 않는다.
    if (socketState.retryNotBefore > Date.now()) return

    if (status.value === 'reconnecting' && socketState.reconnectTimer) {
      connect()
    }
  }

  function handlePageHide() {
    socketState.pageHidden = true
    if (!socketState.socket) return
    socketState.stopped = true
    clearTimers()
    handlers.failPendingMessages('연결이 끊겨 전송 결과를 확인하지 못했습니다. 다시 연결되면 자동으로 재전송합니다.')
    socketState.socket.close(PARTY_CLOSE_PAGE_HIDE.code, PARTY_CLOSE_PAGE_HIDE.reason)
  }

  function handlePageShow(event: PageTransitionEvent) {
    if (!event.persisted) return
    socketState.pageHidden = false
    if (socketState.disposed || !socketState.credentials || socketState.autoReconnectSuspended) return
    socketState.stopped = false
    if (socketState.retryNotBefore > Date.now()) scheduleReconnect()
    else connect()
  }

  return { connect, clearTimers, scheduleReconnect, handleVisibilityOrOnline, handlePageHide, handlePageShow }
}
