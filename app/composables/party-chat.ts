import {
  PARTY_CLOSE_LEAVE,
  PARTY_CLOSE_PAGE_HIDE,
  PARTY_CLOSE_UNRESPONSIVE_CODE,
  PARTY_HISTORY_MAX_MESSAGES,
  PARTY_MAX_TEXT_LENGTH,
  getPartyTextLength,
  type PartyCharacterId,
  type PartyChatMessage,
  type PartyConnectionDiagnostics,
  type PartyOrder,
  type PartyParticipant,
  type PartyRoomMessage,
  type PartyServerMessage
} from '#shared/types/party'
import { readBrowserStorage, removeBrowserStorage, writeBrowserStorage } from '~/utils/browser-storage'

interface PartyCredentials {
  nickname: string
  characterId: PartyCharacterId
  order: PartyOrder | null
}

interface LocalPartyChatMessage extends PartyChatMessage {
  delivery: 'sending' | 'failed' | 'unconfirmed'
  failureReason?: string
}

type PartyDisplayMessage = PartyRoomMessage | LocalPartyChatMessage

interface PartyResumeRecord {
  version: 1
  roomId: string
  sessionId: string
  nicknameKey: string
  reconnectToken: string
}

export interface PartyResumeContext {
  reconnectToken: string
  sessionId: string
}

const MAX_EXPANDED_MESSAGES = PARTY_HISTORY_MAX_MESSAGES * 2
// 한 탭은 한 번에 하나의 채팅 세션만 이어가므로 재개 기록도 탭 단위로 보관한다.
const RESUME_STORAGE_KEY = 'party-chat-resume'
const RESUME_STORAGE_VERSION = 1 as const
const SESSION_CHANGED_REASON = '채팅방 세션이 바뀌어 전송 결과를 확인하지 못했습니다. 다시 보내면 중복될 수 있습니다.'
const PARTICIPANT_CHANGED_REASON = '연결이 오래 끊겨 새 참여자로 다시 입장해 전송 결과를 확인하지 못했습니다. 다시 보내면 중복될 수 있습니다.'
// 화면 복귀·온라인 전환 뒤 보낸 PING에 이 시간 안에 아무것도 오지 않으면 소켓을 포기하고 다시 연결한다.
const LIVENESS_TIMEOUT_MS = 5_000
const FATAL_JOIN_ERROR_CODES = new Set([
  'INVALID_ROOM_ID',
  'INVALID_NICKNAME',
  'INVALID_CHARACTER',
  'INVALID_ORDER',
  'SPECTATOR_ORDER_DISABLED',
  'ROOM_NOT_FOUND',
  'NICKNAME_TAKEN'
])
// 서버가 재시도를 허용하는 오류는 입장 상태를 유지한 채 백오프로 다시 시도한다.
const RETRYABLE_JOIN_ERROR_CODES = new Set([
  'JOIN_RATE_LIMITED',
  'STORAGE_UNAVAILABLE',
  'CONNECTION_CLOSED'
])

function isPartyResumeRecord(value: unknown): value is PartyResumeRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.version === RESUME_STORAGE_VERSION
    && typeof record.roomId === 'string'
    && typeof record.sessionId === 'string'
    && record.sessionId.length > 0
    && typeof record.nicknameKey === 'string'
    && record.nicknameKey.length > 0
    && typeof record.reconnectToken === 'string'
    && record.reconnectToken.length > 0
}

function readRetryAfterMs(message: PartyServerMessage): number | undefined {
  const value = (message as { retryAfterMs?: unknown }).retryAfterMs
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function isLocalMessage(message: PartyDisplayMessage): message is LocalPartyChatMessage {
  return message.kind === 'chat' && 'delivery' in message
}

function normalizeNicknameKey(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase()
}

function mergeSessionMessages(
  existing: PartyRoomMessage[],
  incoming: PartyRoomMessage[]
): PartyRoomMessage[] {
  if (existing.length === 0) return [...incoming]
  if (incoming.length === 0) return [...existing]

  const incomingById = new Map(incoming.map(message => [message.id, message]))
  const firstIncomingId = incoming[0]?.id
  const firstOverlapIndex = firstIncomingId
    ? existing.findIndex(message => message.id === firstIncomingId)
    : -1

  const prefix = firstOverlapIndex >= 0
    ? existing.slice(0, firstOverlapIndex).filter(message => !incomingById.has(message.id))
    : existing.filter(message => !incomingById.has(message.id))

  const merged = [...prefix, ...incoming]
  const seen = new Set<string>()
  return merged.filter((message) => {
    if (seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
}

export function usePartyChat(roomId: string) {
  const status = ref<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'>('idle')
  const messages = ref<PartyDisplayMessage[]>([])
  const participants = ref<PartyParticipant[]>([])
  const participantId = ref('')
  const activeCharacterId = ref<PartyCharacterId | null>(null)
  const activeOrder = ref<PartyOrder | null>(null)
  const error = ref('')
  const errorCode = ref('')
  const joined = ref(false)
  const loadingOlder = ref(false)
  const hasOlder = ref(false)
  const historyError = ref('')
  let requestedBefore = ''
  let loadedHistory = false
  let socket: WebSocket | undefined
  let activeSessionId: string | undefined
  let activeReconnectToken: string | undefined
  let credentials: PartyCredentials | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let connectionTimer: ReturnType<typeof setTimeout> | undefined
  let livenessTimer: typeof connectionTimer
  const sendTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let historyTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let disposed = false
  let attempt = 0
  let connectionAttempt = 0
  let firstJoin = true
  let lastClosedAt: number | undefined
  let lastCloseDiagnostics: PartyConnectionDiagnostics = {}
  let unansweredPings = 0
  let lastReceivedAt = 0
  // 서버가 알려준 재시도 시각 이전에는 온라인/가시성 이벤트로도 앞당기지 않는다.
  let retryNotBefore = 0
  let pageHidden = false
  let autoReconnectSuspended = false
  const recovering = ref(false)
  const admissionErrorCode = ref('')

  function clearTimers() {
    clearTimeout(reconnectTimer)
    clearTimeout(connectionTimer)
    clearInterval(heartbeatTimer)
    clearTimeout(livenessTimer)
    clearTimeout(historyTimer)
    reconnectTimer = undefined
    connectionTimer = undefined
    heartbeatTimer = undefined
    livenessTimer = undefined
    historyTimer = undefined
  }

  function clearSendTimer(clientMessageId: string) {
    clearTimeout(sendTimers.get(clientMessageId))
    sendTimers.delete(clientMessageId)
  }

  function failMessage(clientMessageId: string, reason: string, delivery: 'failed' | 'unconfirmed' = 'unconfirmed') {
    clearSendTimer(clientMessageId)
    messages.value = messages.value.map(message => isLocalMessage(message) && message.clientMessageId === clientMessageId
      ? { ...message, delivery, failureReason: reason }
      : message)
  }

  function failPendingMessages(reason: string, delivery: 'failed' | 'unconfirmed' = 'unconfirmed') {
    for (const clientMessageId of [...sendTimers.keys()]) failMessage(clientMessageId, reason, delivery)
  }

  function readResumeRecord(): PartyResumeRecord | null {
    const stored = readBrowserStorage(RESUME_STORAGE_KEY, 'session')
    if (!stored) return null
    try {
      const parsed: unknown = JSON.parse(stored)
      if (isPartyResumeRecord(parsed)) return parsed
    } catch {
      // 손상된 재개 기록은 버리고 새 입장으로 진행한다.
    }
    removeBrowserStorage(RESUME_STORAGE_KEY, 'session')
    return null
  }

  function clearResumeRecord() {
    removeBrowserStorage(RESUME_STORAGE_KEY, 'session')
  }

  function clearResumeContext() {
    // 저장 기록과 함께 메모리에 남은 재개 토큰도 무효화한다.
    clearResumeRecord()
    activeReconnectToken = undefined
  }

  function persistResumeRecord(sessionIdValue: string) {
    if (!credentials || !activeReconnectToken) return
    const record: PartyResumeRecord = {
      version: RESUME_STORAGE_VERSION,
      roomId,
      sessionId: sessionIdValue,
      nicknameKey: normalizeNicknameKey(credentials.nickname),
      reconnectToken: activeReconnectToken
    }
    writeBrowserStorage(RESUME_STORAGE_KEY, JSON.stringify(record), 'session')
  }

  function trimDisplayMessages(next: PartyDisplayMessage[]): PartyDisplayMessage[] {
    const limit = loadedHistory ? MAX_EXPANDED_MESSAGES : PARTY_HISTORY_MAX_MESSAGES
    if (next.length <= limit) return next

    const removed = next.slice(0, next.length - limit)
    if (removed.some(message => !isLocalMessage(message))) {
      hasOlder.value = true
    }
    return next.slice(-limit)
  }

  function appendMessage(message: PartyRoomMessage) {
    const index = messages.value.findIndex(existing => existing.id === message.id || (message.kind === 'chat'
      && isLocalMessage(existing)
      && existing.clientMessageId === message.clientMessageId))
    if (index >= 0) {
      if (isLocalMessage(messages.value[index]!)) {
        messages.value = messages.value.map((existing, position) => position === index ? message : existing)
      }
      if (message.kind === 'chat') clearSendTimer(message.clientMessageId)
      return
    }
    messages.value = trimDisplayMessages([...messages.value, message])
    if (message.kind === 'chat') clearSendTimer(message.clientMessageId)
  }

  function scheduleReconnect() {
    if (stopped || disposed || !credentials || autoReconnectSuspended) return
    clearTimers()
    const baseDelay = Math.min(1000 * 2 ** attempt++, 5000)
    const jitter = Math.floor(Math.random() * 300)
    // 서버가 알려준 재시도 시각은 지수 백오프보다 우선한다.
    const cooldownDelay = Math.max(0, retryNotBefore - Date.now())
    reconnectTimer = setTimeout(connect, Math.max(baseDelay + jitter, cooldownDelay))
  }

  function handleAdmissionError(ws: WebSocket, message: PartyServerMessage & { type: 'ERROR' }) {
    const retryAfterMs = readRetryAfterMs(message)
    const code = message.code
    // 복구 중이거나 이미 입장한 세션이면 대화와 토큰을 지키는 쪽을 먼저 본다.
    const established = recovering.value || joined.value
    error.value = message.message
    errorCode.value = message.code

    // 서버가 재시도 시각을 알려주면 그때까지 기다린 뒤 자동으로 다시 시도한다.
    if (retryAfterMs !== undefined) {
      retryNotBefore = Date.now() + retryAfterMs
      ws.close()
      return
    }

    if (RETRYABLE_JOIN_ERROR_CODES.has(code)) {
      ws.close()
      return
    }

    if (established && !FATAL_JOIN_ERROR_CODES.has(code)) {
      // 원인을 알 수 없는 오류도 지수 백오프 범위 안에서만 다시 시도한다.
      ws.close()
      return
    }

    // 이 지점부터는 자동 재시도를 멈추는 최종 실패이므로 최종 코드만 노출한다.
    admissionErrorCode.value = code
    // 소유권이 확인되지 않은 재개 수단은 저장 기록과 메모리 토큰 모두 무효화한다.
    clearResumeContext()
    if (established) {
      // 복구 중 최종 실패는 대화와 미확인 메시지를 지키고 사용자의 선택을 기다린다.
      stopForAdmissionConflict(code, message.message)
    } else {
      // 새 입장의 최종 실패만 닉네임 입력부터 다시 받는다.
      resetAdmissionFailure()
    }
    ws.close()
  }

  function resetAdmissionFailure() {
    stopped = true
    status.value = 'error'
    joined.value = false
    recovering.value = false
    clearResumeContext()
    activeCharacterId.value = null
    activeOrder.value = null
    messages.value = []
    hasOlder.value = false
    participants.value = []
    clearTimers()
  }

  function stopForAdmissionConflict(code: string, message: string) {
    // 자동 재시도를 멈추지만 대화와 미확인 메시지는 그대로 남긴다.
    autoReconnectSuspended = true
    admissionErrorCode.value = code
    error.value = message
    errorCode.value = code
    status.value = 'error'
    clearTimers()
  }

  function connect() {
    if (stopped || disposed || !credentials) return
    clearTimers()
    status.value = joined.value ? 'reconnecting' : 'connecting'
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/party`)
    connectionAttempt++
    socket = ws
    connectionTimer = setTimeout(() => abandonSocket(ws, 'join-timeout'), 20_000)
    ws.onopen = () => {
      if (socket !== ws || stopped || disposed) return
      unansweredPings = 0
      lastReceivedAt = Date.now()
      const navigation = firstJoin && typeof performance !== 'undefined'
        ? performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        : undefined
      const diagnostics: PartyConnectionDiagnostics = {
        attempt: connectionAttempt,
        ...lastCloseDiagnostics,
        ...(lastClosedAt !== undefined ? { lastCloseAgoMs: Date.now() - lastClosedAt } : {}),
        ...(navigation?.type ? { navigationType: navigation.type } : {})
      }
      firstJoin = false
      ws.send(JSON.stringify({
        type: 'JOIN',
        roomId,
        ...credentials,
        ...(activeReconnectToken ? { reconnectToken: activeReconnectToken } : {}),
        diagnostics
      }))
      heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        const now = Date.now()
        if (unansweredPings >= 2 && now - lastReceivedAt >= 55_000) {
          abandonSocket(ws, 'heartbeat-timeout')
          return
        }
        ws.send(JSON.stringify({ type: 'PING' }))
        unansweredPings++
      }, 20_000)
    }
    ws.onmessage = (event) => {
      if (socket !== ws || stopped || disposed) return
      unansweredPings = 0
      lastReceivedAt = Date.now()
      let data: PartyServerMessage
      try {
        data = JSON.parse(event.data) as PartyServerMessage
      } catch {
        return
      }
      if (data.type === 'JOINED') {
        clearTimeout(connectionTimer)
        connectionTimer = undefined
        attempt = 0
        connectionAttempt = 0
        retryNotBefore = 0
        status.value = 'connected'
        joined.value = true
        error.value = ''
        errorCode.value = ''
        admissionErrorCode.value = ''
        recovering.value = false
        autoReconnectSuspended = false
        const previousParticipantId = participantId.value
        participantId.value = data.participantId
        activeReconnectToken = data.reconnectToken
        const sameSession = Boolean(activeSessionId && activeSessionId === data.sessionId)
        const sessionChanged = Boolean(activeSessionId) && !sameSession
        // 유예가 끝나 새 참여자로 들어오면 서버 중복 방지(참여자 단위)가 이전 전송을 알아보지 못한다.
        const participantChanged = sameSession && Boolean(previousParticipantId) && previousParticipantId !== data.participantId
        const identityChanged = sessionChanged || participantChanged
        const identityChangedReason = sessionChanged ? SESSION_CHANGED_REASON : PARTICIPANT_CHANGED_REASON
        const confirmedIds = new Set(data.messages.filter((message): message is PartyChatMessage => message.kind === 'chat')
          .map(message => message.clientMessageId))
        const existingConfirmed = sameSession
          ? messages.value.filter((message): message is PartyRoomMessage => !isLocalMessage(message))
          : []
        const mergedHistory = sameSession
          ? mergeSessionMessages(existingConfirmed, data.messages)
          : [...data.messages]
        const allConfirmedIds = new Set([
          ...confirmedIds,
          ...mergedHistory.filter((message): message is PartyChatMessage => message.kind === 'chat').map(message => message.clientMessageId)
        ])
        // 세션이나 참여자가 바뀌면 자동 재전송할 수 없으므로 지우지 않고 다시 입력할 수 있는 실패로 남긴다.
        const unresolved = messages.value
          .filter(isLocalMessage)
          .filter(message => !allConfirmedIds.has(message.clientMessageId))
          .map(message => identityChanged
            ? { ...message, delivery: 'failed' as const, failureReason: identityChangedReason }
            : message)
        activeSessionId = data.sessionId
        if (!sameSession) loadedHistory = false
        hasOlder.value = sameSession
          ? (hasOlder.value || data.messages.length > 0)
          : data.messages.length > 0
        messages.value = trimDisplayMessages([...mergedHistory, ...unresolved])
        for (const clientMessageId of allConfirmedIds) clearSendTimer(clientMessageId)
        if (identityChanged) failPendingMessages(identityChangedReason, 'failed')
        loadingOlder.value = false
        clearTimeout(historyTimer)
        historyTimer = undefined
        historyError.value = ''
        requestedBefore = ''
        participants.value = data.participants
        const self = data.participants.find(participant => participant.id === data.participantId)
        activeCharacterId.value = self?.characterId ?? credentials?.characterId ?? null
        activeOrder.value = self?.order ?? null
        if (self && credentials) {
          credentials.characterId = self.characterId
          credentials.order = self.order
        }
        // 입장이 확정된 뒤에만 재개 기록을 남겨 새로 고침 복구가 토큰을 재사용할 수 있게 한다.
        persistResumeRecord(data.sessionId)
        if (sameSession && !identityChanged) {
          for (const message of messages.value.filter(isLocalMessage)) {
            if (message.delivery === 'failed') continue
            sendMessage(ws, message.clientMessageId, message.text)
          }
        }
      } else if (data.type === 'CHAT') {
        appendMessage(data.message)
      } else if (data.type === 'JOIN_NOTICE') {
        appendMessage(data.notice)
      } else if (data.type === 'LEAVE_NOTICE') {
        appendMessage(data.notice)
      } else if (data.type === 'HISTORY') {
        if (!loadingOlder.value || data.before !== requestedBefore) return
        const known = new Set(messages.value.map(message => message.id))
        const older = data.messages.filter(message => !known.has(message.id))
        const confirmedIds = new Set(older.filter((message): message is PartyChatMessage => message.kind === 'chat').map(message => message.clientMessageId))
        if (older.length > 0) {
          loadedHistory = true
        }
        const combined = [...older, ...messages.value.filter(message => !isLocalMessage(message) || !confirmedIds.has(message.clientMessageId))]
        messages.value = combined.length > MAX_EXPANDED_MESSAGES
          ? combined.slice(0, MAX_EXPANDED_MESSAGES)
          : combined
        for (const clientMessageId of confirmedIds) clearSendTimer(clientMessageId)
        hasOlder.value = data.hasMore
        loadingOlder.value = false
        clearTimeout(historyTimer)
        historyTimer = undefined
        requestedBefore = ''
        historyError.value = ''
      } else if (data.type === 'PARTICIPANTS') {
        participants.value = data.participants
        const currentParticipants = new Map(data.participants.map(participant => [participant.id, participant]))
        messages.value = messages.value.map((message) => {
          if (message.kind !== 'chat') return message
          const current = currentParticipants.get(message.participant.id)
          return current && (current.characterId !== message.participant.characterId || current.order !== message.participant.order)
            ? { ...message, participant: { ...message.participant, characterId: current.characterId, order: current.order } }
            : message
        })
        const self = currentParticipants.get(participantId.value)
        if (self) {
          activeCharacterId.value = self.characterId
          activeOrder.value = self.order
          if (credentials) {
            credentials.characterId = self.characterId
            credentials.order = self.order
          }
        }
      } else if (data.type === 'ERROR') {
        if (loadingOlder.value && (data.code === 'HISTORY_UNAVAILABLE' || data.code === 'INVALID_CURSOR')) {
          loadingOlder.value = false
          clearTimeout(historyTimer)
          historyTimer = undefined
          requestedBefore = ''
          historyError.value = data.message
          return
        }
        error.value = data.message
        errorCode.value = data.code
        if (data.clientMessageId) failMessage(data.clientMessageId, data.message, 'failed')
        if (status.value !== 'connected') {
          handleAdmissionError(ws, data)
        }
      }
    }
    ws.onerror = () => { /* The close handler retries failed connections. */ }
    ws.onclose = event => handleSocketClosed(ws, event)
  }

  function handleSocketClosed(ws: WebSocket, event: { code?: number, reason?: string } | undefined) {
    lastClosedAt = Date.now()
    lastCloseDiagnostics = {
      ...(typeof event?.code === 'number' ? { lastCloseCode: event.code } : {}),
      ...(typeof event?.reason === 'string' ? { lastCloseReason: event.reason } : {}),
      ...(typeof document !== 'undefined' ? { hiddenAtClose: document.visibilityState === 'hidden' } : {}),
      ...(typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? { onlineAtClose: navigator.onLine } : {})
    }
    if (socket !== ws || stopped || disposed) return
    if (event?.reason === 'replaced-by-reconnect') {
      // 다른 탭이 같은 세션을 이어받았으므로 이 탭은 물러나고 재개 수단을 정리한다.
      clearResumeContext()
      autoReconnectSuspended = true
      status.value = 'error'
      error.value = '다른 탭에서 이 채팅방에 다시 연결했습니다. 이 탭에서 계속하려면 다시 입장해 주세요.'
      clearTimers()
      return
    }
    failPendingMessages('연결이 끊겨 전송 결과를 확인하지 못했습니다. 다시 연결되면 자동으로 재전송합니다.')
    clearTimers()
    loadingOlder.value = false
    clearTimeout(historyTimer)
    historyTimer = undefined
    requestedBefore = ''
    // 자동 재시도를 멈춘 상태라면 종료 원인이 된 입장 오류 화면을 덮어쓰지 않는다.
    if (autoReconnectSuspended) return
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

  function getResumeContext(nickname: string): PartyResumeContext | null {
    const record = readResumeRecord()
    if (!record) return null
    // 다른 방이나 다른 닉네임의 기록은 재사용하지 않고 즉시 정리한다.
    if (record.roomId !== roomId || record.nicknameKey !== normalizeNicknameKey(nickname)) {
      clearResumeRecord()
      return null
    }
    return { reconnectToken: record.reconnectToken, sessionId: record.sessionId }
  }
  function join(value: PartyCredentials, resume?: PartyResumeContext) {
    if (disposed) return
    failPendingMessages('전송 결과를 확인하지 못했습니다. 다시 연결되면 자동으로 재전송합니다.')
    clearTimers()
    const previous = socket
    socket = undefined
    previous?.close()
    stopped = false
    autoReconnectSuspended = false
    retryNotBefore = 0
    recovering.value = Boolean(resume)
    admissionErrorCode.value = ''
    if (!credentials || normalizeNicknameKey(credentials.nickname) !== normalizeNicknameKey(value.nickname)) {
      activeReconnectToken = undefined
      activeSessionId = undefined
      if (!resume) clearResumeRecord()
    }
    if (resume) {
      activeReconnectToken = resume.reconnectToken
      // 이전 세션 ID를 기억해 두면 조인 응답과 기록을 같은 세션으로 병합할 수 있다.
      activeSessionId = resume.sessionId
    }
    credentials = { ...value }
    error.value = ''
    errorCode.value = ''
    attempt = 0
    hasOlder.value = false
    historyError.value = ''
    loadedHistory = false
    connect()
  }

  function loadOlder(): boolean {
    if (status.value !== 'connected' || socket?.readyState !== WebSocket.OPEN || loadingOlder.value || !hasOlder.value) return false
    const before = messages.value[0]?.id
    if (!before) return false
    requestedBefore = before
    loadingOlder.value = true
    historyError.value = ''
    socket.send(JSON.stringify({ type: 'HISTORY', before }))
    historyTimer = setTimeout(() => {
      if (requestedBefore !== before || !loadingOlder.value) return
      loadingOlder.value = false
      requestedBefore = ''
      historyError.value = '이전 대화를 불러오지 못했습니다. 다시 시도해 주세요.'
    }, 10_000)
    return true
  }

  function sendMessage(ws: WebSocket, clientMessageId: string, text: string) {
    clearSendTimer(clientMessageId)
    messages.value = messages.value.map(message => isLocalMessage(message) && message.clientMessageId === clientMessageId
      ? { ...message, delivery: 'sending', failureReason: undefined }
      : message)
    try {
      ws.send(JSON.stringify({ type: 'CHAT', text, clientMessageId }))
    } catch {
      failMessage(clientMessageId, '메시지를 보내지 못했습니다. 다시 시도해 주세요.', 'failed')
      error.value = '메시지를 보내지 못했습니다. 다시 시도해 주세요.'
      ws.close()
      return
    }
    sendTimers.set(clientMessageId, setTimeout(() => {
      if (!sendTimers.has(clientMessageId)) return
      failMessage(clientMessageId, '전송 확인이 지연되었습니다. 다시 연결되면 자동으로 재전송합니다.')
      error.value = '전송 확인이 지연되었습니다. 잠시 후 다시 확인해 주세요.'
    }, 15_000))
  }

  function send(text: string): boolean {
    const currentSocket = socket
    const trimmed = text.trim()
    if (
      status.value !== 'connected'
      || currentSocket?.readyState !== WebSocket.OPEN
      || !trimmed
      || getPartyTextLength(trimmed) > PARTY_MAX_TEXT_LENGTH
    ) {
      return false
    }
    const self = participants.value.find(participant => participant.id === participantId.value)
    if (!self) return false
    const clientMessageId = crypto.randomUUID()
    const optimisticMessage: LocalPartyChatMessage = {
      kind: 'chat',
      id: clientMessageId,
      clientMessageId,
      participant: { ...self },
      text: trimmed,
      createdAt: new Date().toISOString(),
      delivery: 'sending'
    }
    messages.value = trimDisplayMessages([...messages.value, optimisticMessage])
    error.value = ''
    sendMessage(currentSocket, clientMessageId, text)
    return true
  }

  function takeLocalMessage(clientMessageId: string): string | null {
    const local = messages.value.find(message => isLocalMessage(message) && message.clientMessageId === clientMessageId && message.delivery !== 'sending')
    if (!local || !isLocalMessage(local)) return null
    messages.value = messages.value.filter(message => !isLocalMessage(message) || message.clientMessageId !== clientMessageId)
    return local.text
  }

  function changeCharacter(characterId: PartyCharacterId): boolean {
    if (status.value !== 'connected' || socket?.readyState !== WebSocket.OPEN || !joined.value) return false
    try {
      socket.send(JSON.stringify({ type: 'SET_CHARACTER', characterId }))
      error.value = ''
      return true
    } catch {
      error.value = '캐릭터 변경 요청을 보내지 못했습니다. 다시 시도해 주세요.'
      return false
    }
  }

  function changeOrder(order: PartyOrder): boolean {
    if (status.value !== 'connected' || socket?.readyState !== WebSocket.OPEN || !joined.value) return false
    try {
      socket.send(JSON.stringify({ type: 'SET_ORDER', order }))
      error.value = ''
      return true
    } catch {
      error.value = '순서 변경 요청을 보내지 못했습니다. 다시 시도해 주세요.'
      return false
    }
  }

  function handleVisibilityOrOnline() {
    if (disposed || stopped || !credentials || autoReconnectSuspended) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    const current = socket
    if (current?.readyState === WebSocket.OPEN) {
      // 백그라운드에서 이미 죽은 소켓도 OPEN으로 남는다. heartbeat가 알아채기까지 1분 넘게 기다리지 않도록 바로 확인한다.
      const probeStartedAt = Date.now()
      try {
        current.send(JSON.stringify({ type: 'PING' }))
      } catch {
        abandonSocket(current, 'liveness-timeout')
        return
      }
      if (livenessTimer) return
      livenessTimer = setTimeout(() => {
        livenessTimer = undefined
        if (socket !== current || lastReceivedAt >= probeStartedAt) return
        abandonSocket(current, 'liveness-timeout')
      }, LIVENESS_TIMEOUT_MS)
      return
    }

    // 서버가 정한 재시도 시각 전에는 가시성/온라인 이벤트로도 앞당기지 않는다.
    if (retryNotBefore > Date.now()) return

    if (status.value === 'reconnecting' && reconnectTimer) {
      connect()
    }
  }

  function handlePageHide() {
    pageHidden = true
    if (!socket) return
    stopped = true
    clearTimers()
    failPendingMessages('연결이 끊겨 전송 결과를 확인하지 못했습니다. 다시 연결되면 자동으로 재전송합니다.')
    socket.close(PARTY_CLOSE_PAGE_HIDE.code, PARTY_CLOSE_PAGE_HIDE.reason)
  }

  function handlePageShow(event: PageTransitionEvent) {
    if (!event.persisted) return
    pageHidden = false
    if (disposed || !credentials || autoReconnectSuspended) return
    stopped = false
    if (retryNotBefore > Date.now()) scheduleReconnect()
    else connect()
  }

  function handleReconnectAction() {
    if (disposed || !credentials) return false
    autoReconnectSuspended = false
    stopped = false
    attempt = 0
    retryNotBefore = 0
    status.value = 'reconnecting'
    error.value = ''
    errorCode.value = ''
    admissionErrorCode.value = ''
    connect()
    return true
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleVisibilityOrOnline)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisibilityOrOnline)
  }

  onBeforeUnmount(() => {
    disposed = true
    stopped = true
    clearTimers()
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleVisibilityOrOnline)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline)
    }
    for (const clientMessageId of sendTimers.keys()) clearSendTimer(clientMessageId)
    if (pageHidden) {
      // 문서가 사라지는 경우에는 서버 유예 시간이 만료를 판단하도록 토큰을 남긴다.
      credentials = undefined
      return
    }
    clearResumeRecord()
    socket?.close(PARTY_CLOSE_LEAVE.code, PARTY_CLOSE_LEAVE.reason)
    credentials = undefined
  })

  return {
    status,
    messages,
    participants,
    participantId,
    activeCharacterId,
    activeOrder,
    error,
    errorCode,
    admissionErrorCode,
    recovering,
    joined,
    loadingOlder,
    hasOlder,
    historyError,
    join,
    send,
    takeLocalMessage,
    loadOlder,
    changeCharacter,
    changeOrder,
    getResumeContext,
    clearResumeContext,
    retryAdmission: handleReconnectAction
  }
}
