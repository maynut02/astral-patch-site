import { PARTY_CLOSE_LEAVE, PARTY_HISTORY_MAX_MESSAGES, PARTY_MAX_TEXT_LENGTH, getPartyTextLength, type PartyCharacterId, type PartyChatMessage, type PartyOrder, type PartyParticipant, type PartyRoomMessage, type PartyServerMessage } from '#shared/types/party'
import { DISPLAY_MESSAGE_CAP, isLocalMessage, mergeSessionMessages, normalizeNicknameKey, type LocalPartyChatMessage, type PartyDisplayMessage } from '~/utils/party-message-merge'
import { clearResumeRecord, getPartyResumeContext, persistResumeRecord, type PartyResumeContext } from '~/utils/party-resume-storage'
import { createPartySocketLifecycle, createPartySocketState, type PartyCredentials } from '~/utils/party-socket-lifecycle'
import { PARTY_FATAL_JOIN_ERROR_CODES, PARTY_RETRYABLE_JOIN_ERROR_CODES, encodePartyClientMessage, readPartyRetryAfterMs } from '~/utils/party-wire'

const SESSION_CHANGED_REASON = '채팅방 세션이 바뀌어 전송 결과를 확인하지 못했습니다. 다시 보내면 중복될 수 있습니다.'
const PARTICIPANT_CHANGED_REASON = '연결이 오래 끊겨 새 참여자로 다시 입장해 전송 결과를 확인하지 못했습니다. 다시 보내면 중복될 수 있습니다.'

export function usePartyChat(roomId: string) {
  const status = ref<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'>('idle')
  const messages = ref<PartyDisplayMessage[]>([])
  const appendedMessageVersion = ref(0)
  const participants = ref<PartyParticipant[]>([])
  const participantId = ref('')
  const activeCharacterId = ref<PartyCharacterId | null>(null)
  const activeOrder = ref<PartyOrder | null>(null)
  const error = ref('')
  const joined = ref(false)
  const loadingOlder = ref(false)
  const hasOlder = ref(false)
  const historyError = ref('')
  let requestedBefore = ''
  let loadedHistory = false
  let activeSessionId: string | undefined
  let activeReconnectToken: string | undefined
  const sendTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let historyTimer: ReturnType<typeof setTimeout> | undefined
  // 서버가 알려준 재시도 시각 이전에는 온라인/가시성 이벤트로도 앞당기지 않는다.
  const recovering = ref(false)
  const admissionErrorCode = ref('')
  const socketState = createPartySocketState()
  const { connect, clearTimers, handleVisibilityOrOnline, handlePageHide, handlePageShow } = createPartySocketLifecycle(roomId, socketState, () => activeReconnectToken, {
    status, error, joined, clearResumeContext, failPendingMessages, message: handleServerMessage,
    clearHistoryTimer() {
      clearTimeout(historyTimer)
      historyTimer = undefined
    },
    disconnected() {
      loadingOlder.value = false
      requestedBefore = ''
    }
  })

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

  function clearResumeContext() {
    // 저장 기록과 함께 메모리에 남은 재개 토큰도 무효화한다.
    clearResumeRecord()
    activeReconnectToken = undefined
  }

  function trimDisplayMessages(next: PartyDisplayMessage[]): PartyDisplayMessage[] {
    const limit = loadedHistory ? DISPLAY_MESSAGE_CAP : PARTY_HISTORY_MAX_MESSAGES
    if (next.length <= limit) return next

    const removed = next.slice(0, next.length - limit)
    if (removed.some(message => !isLocalMessage(message))) {
      hasOlder.value = true
    }
    return next.slice(-limit)
  }

  function appendMessage(message: PartyRoomMessage) {
    const messageKey = message.kind === 'chat' ? message.clientMessageId : message.id
    let alreadyDisplayed = false
    const index = messages.value.findIndex((existing) => {
      if ((existing.kind === 'chat' ? existing.clientMessageId : existing.id) === messageKey) alreadyDisplayed = true
      return existing.id === message.id || (message.kind === 'chat'
        && isLocalMessage(existing)
        && existing.clientMessageId === message.clientMessageId)
    })
    if (index >= 0) {
      if (isLocalMessage(messages.value[index]!)) {
        messages.value = messages.value.map((existing, position) => position === index ? message : existing)
      }
      if (message.kind === 'chat') clearSendTimer(message.clientMessageId)
      return
    }
    messages.value = trimDisplayMessages([...messages.value, message])
    if (!alreadyDisplayed) appendedMessageVersion.value++
    if (message.kind === 'chat') clearSendTimer(message.clientMessageId)
  }

  function handleAdmissionError(ws: WebSocket, message: PartyServerMessage & { type: 'ERROR' }) {
    const retryAfterMs = readPartyRetryAfterMs(message)
    const code = message.code
    // 복구 중이거나 이미 입장한 세션이면 대화와 토큰을 지키는 쪽을 먼저 본다.
    const established = recovering.value || joined.value
    error.value = message.message

    // 서버가 재시도 시각을 알려주면 그때까지 기다린 뒤 자동으로 다시 시도한다.
    if (retryAfterMs !== undefined) {
      socketState.retryNotBefore = Date.now() + retryAfterMs
      ws.close()
      return
    }

    if (PARTY_RETRYABLE_JOIN_ERROR_CODES.has(code)) {
      ws.close()
      return
    }

    if (established && !PARTY_FATAL_JOIN_ERROR_CODES.has(code)) {
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
    socketState.stopped = true
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
    socketState.autoReconnectSuspended = true
    admissionErrorCode.value = code
    error.value = message
    status.value = 'error'
    clearTimers()
  }

  function handleServerMessage(data: PartyServerMessage, ws: WebSocket) {
    if (data.type === 'JOINED') {
      clearTimeout(socketState.connectionTimer)
      socketState.connectionTimer = undefined
      socketState.attempt = 0
      socketState.connectionAttempt = 0
      socketState.retryNotBefore = 0
      status.value = 'connected'
      joined.value = true
      error.value = ''
      admissionErrorCode.value = ''
      recovering.value = false
      socketState.autoReconnectSuspended = false
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
      const nextMessages = trimDisplayMessages([...mergedHistory, ...unresolved])
      const latest = nextMessages.at(-1)
      const latestKey = latest?.kind === 'chat' ? latest.clientMessageId : latest?.id
      const alreadyDisplayed = messages.value.some(message => (message.kind === 'chat' ? message.clientMessageId : message.id) === latestKey)
      messages.value = nextMessages
      if (latest && !alreadyDisplayed) appendedMessageVersion.value++
      for (const clientMessageId of allConfirmedIds) clearSendTimer(clientMessageId)
      if (identityChanged) failPendingMessages(identityChangedReason, 'failed')
      loadingOlder.value = false
      clearTimeout(historyTimer)
      historyTimer = undefined
      historyError.value = ''
      requestedBefore = ''
      participants.value = data.participants
      const self = data.participants.find(participant => participant.id === data.participantId)
      activeCharacterId.value = self?.characterId ?? socketState.credentials?.characterId ?? null
      activeOrder.value = self?.order ?? null
      if (self && socketState.credentials) {
        socketState.credentials.characterId = self.characterId
        socketState.credentials.order = self.order
      }
      // 입장이 확정된 뒤에만 재개 기록을 남겨 새로 고침 복구가 토큰을 재사용할 수 있게 한다.
      persistResumeRecord(roomId, socketState.credentials?.nickname ?? '', activeReconnectToken, data.sessionId)
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
      messages.value = combined.length > DISPLAY_MESSAGE_CAP
        ? combined.slice(0, DISPLAY_MESSAGE_CAP)
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
        if (socketState.credentials) {
          socketState.credentials.characterId = self.characterId
          socketState.credentials.order = self.order
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
      if (data.clientMessageId) failMessage(data.clientMessageId, data.message, 'failed')
      if (status.value !== 'connected') {
        handleAdmissionError(ws, data)
      }
    }
  }

  function join(value: PartyCredentials, resume?: PartyResumeContext) {
    if (socketState.disposed) return
    failPendingMessages('전송 결과를 확인하지 못했습니다. 다시 연결되면 자동으로 재전송합니다.')
    clearTimers()
    const previous = socketState.socket
    socketState.socket = undefined
    previous?.close()
    socketState.stopped = false
    socketState.autoReconnectSuspended = false
    socketState.retryNotBefore = 0
    recovering.value = Boolean(resume)
    admissionErrorCode.value = ''
    if (!socketState.credentials || normalizeNicknameKey(socketState.credentials.nickname) !== normalizeNicknameKey(value.nickname)) {
      activeReconnectToken = undefined
      activeSessionId = undefined
      if (!resume) clearResumeRecord()
    }
    if (resume) {
      activeReconnectToken = resume.reconnectToken
      // 이전 세션 ID를 기억해 두면 조인 응답과 기록을 같은 세션으로 병합할 수 있다.
      activeSessionId = resume.sessionId
    }
    socketState.credentials = { ...value }
    error.value = ''
    socketState.attempt = 0
    hasOlder.value = false
    historyError.value = ''
    loadedHistory = false
    connect()
  }

  function loadOlder(): boolean {
    if (status.value !== 'connected' || socketState.socket?.readyState !== WebSocket.OPEN || loadingOlder.value || !hasOlder.value) return false
    const before = messages.value[0]?.id
    if (!before) return false
    requestedBefore = before
    loadingOlder.value = true
    historyError.value = ''
    socketState.socket.send(encodePartyClientMessage({ type: 'HISTORY', before }))
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
      ws.send(encodePartyClientMessage({ type: 'CHAT', text, clientMessageId }))
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
    const currentSocket = socketState.socket
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
    const alreadyDisplayed = messages.value.some(message => (message.kind === 'chat' ? message.clientMessageId : message.id) === clientMessageId)
    messages.value = trimDisplayMessages([...messages.value, optimisticMessage])
    if (!alreadyDisplayed) appendedMessageVersion.value++
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
    if (status.value !== 'connected' || socketState.socket?.readyState !== WebSocket.OPEN || !joined.value) return false
    try {
      socketState.socket.send(encodePartyClientMessage({ type: 'SET_CHARACTER', characterId }))
      error.value = ''
      return true
    } catch {
      error.value = '캐릭터 변경 요청을 보내지 못했습니다. 다시 시도해 주세요.'
      return false
    }
  }

  function changeOrder(order: PartyOrder): boolean {
    if (status.value !== 'connected' || socketState.socket?.readyState !== WebSocket.OPEN || !joined.value) return false
    try {
      socketState.socket.send(encodePartyClientMessage({ type: 'SET_ORDER', order }))
      error.value = ''
      return true
    } catch {
      error.value = '순서 변경 요청을 보내지 못했습니다. 다시 시도해 주세요.'
      return false
    }
  }

  function handleReconnectAction() {
    if (socketState.disposed || !socketState.credentials) return false
    socketState.autoReconnectSuspended = false
    socketState.stopped = false
    socketState.attempt = 0
    socketState.retryNotBefore = 0
    status.value = 'reconnecting'
    error.value = ''
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
    socketState.disposed = true
    socketState.stopped = true
    clearTimers()
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleVisibilityOrOnline)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline)
    }
    for (const clientMessageId of sendTimers.keys()) clearSendTimer(clientMessageId)
    if (socketState.pageHidden) {
      // 문서가 사라지는 경우에는 서버 유예 시간이 만료를 판단하도록 토큰을 남긴다.
      socketState.credentials = undefined
      return
    }
    clearResumeRecord()
    socketState.socket?.close(PARTY_CLOSE_LEAVE.code, PARTY_CLOSE_LEAVE.reason)
    socketState.credentials = undefined
  })

  return {
    status,
    messages,
    appendedMessageVersion,
    participants,
    participantId,
    activeCharacterId,
    activeOrder,
    error,
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
    getResumeContext: (nickname: string) => getPartyResumeContext(roomId, nickname),
    clearResumeContext,
    retryAdmission: handleReconnectAction
  }
}
