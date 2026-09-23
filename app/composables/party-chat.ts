import { PARTY_HISTORY_MAX_MESSAGES, type PartyCharacterId, type PartyChatMessage, type PartyOrder, type PartyParticipant, type PartyRoomMessage, type PartyServerMessage } from '#shared/types/party'

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

function isLocalMessage(message: PartyDisplayMessage): message is LocalPartyChatMessage {
  return message.kind === 'chat' && 'delivery' in message
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
  let credentials: PartyCredentials | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let connectionTimer: ReturnType<typeof setTimeout> | undefined
  const sendTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let historyTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let attempt = 0
  let unansweredPings = 0

  function clearTimers() {
    clearTimeout(reconnectTimer)
    clearTimeout(connectionTimer)
    clearInterval(heartbeatTimer)
    clearTimeout(historyTimer)
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

  function failPendingMessages(reason: string) {
    for (const clientMessageId of [...sendTimers.keys()]) failMessage(clientMessageId, reason)
  }

  function appendMessage(message: PartyRoomMessage) {
    const index = messages.value.findIndex(existing => existing.id === message.id || (message.kind === 'chat'
      && isLocalMessage(existing)
      && existing.clientMessageId === message.clientMessageId
      && existing.participant.id === message.participant.id))
    if (index >= 0) {
      if (isLocalMessage(messages.value[index]!)) {
        messages.value = messages.value.map((existing, position) => position === index ? message : existing)
      }
      if (message.kind === 'chat') clearSendTimer(message.clientMessageId)
      return
    }
    const next = [...messages.value, message]
    messages.value = loadedHistory ? next : next.slice(-PARTY_HISTORY_MAX_MESSAGES)
    if (message.kind === 'chat') clearSendTimer(message.clientMessageId)
  }

  function connect() {
    if (stopped || !credentials) return
    clearTimers()
    status.value = joined.value ? 'reconnecting' : 'connecting'
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/party`)
    socket = ws
    connectionTimer = setTimeout(() => ws.close(), 10_000)
    ws.onopen = () => {
      if (socket !== ws || stopped) return
      unansweredPings = 0
      ws.send(JSON.stringify({ type: 'JOIN', roomId, ...credentials }))
      heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        if (unansweredPings >= 2) {
          ws.close()
          return
        }
        ws.send(JSON.stringify({ type: 'PING' }))
        unansweredPings++
      }, 20_000)
    }
    ws.onmessage = (event) => {
      if (socket !== ws || stopped) return
      unansweredPings = 0
      let data: PartyServerMessage
      try {
        data = JSON.parse(event.data) as PartyServerMessage
      } catch {
        return
      }
      if (data.type === 'JOINED') {
        clearTimeout(connectionTimer)
        attempt = 0
        status.value = 'connected'
        joined.value = true
        error.value = ''
        errorCode.value = ''
        participantId.value = data.participantId
        const confirmedIds = new Set(data.messages.filter((message): message is PartyChatMessage => message.kind === 'chat')
          .map(message => message.clientMessageId))
        const unresolved = activeSessionId && activeSessionId !== data.sessionId
          ? []
          : messages.value.filter(isLocalMessage).filter(message => !confirmedIds.has(message.clientMessageId))
        activeSessionId = data.sessionId
        messages.value = [...data.messages, ...unresolved]
        for (const clientMessageId of confirmedIds) clearSendTimer(clientMessageId)
        failPendingMessages('전송 결과를 확인하지 못했습니다. 다시 보내면 중복될 수 있습니다.')
        hasOlder.value = data.messages.length > 0
        loadingOlder.value = false
        clearTimeout(historyTimer)
        historyError.value = ''
        requestedBefore = ''
        loadedHistory = false
        participants.value = data.participants
        const self = data.participants.find(participant => participant.id === data.participantId)
        activeCharacterId.value = self?.characterId ?? credentials?.characterId ?? null
        activeOrder.value = self?.order ?? null
        if (self && credentials) {
          credentials.characterId = self.characterId
          credentials.order = self.order
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
        messages.value = [...older, ...messages.value.filter(message => !isLocalMessage(message) || !confirmedIds.has(message.clientMessageId))]
        for (const clientMessageId of confirmedIds) clearSendTimer(clientMessageId)
        loadedHistory = true
        hasOlder.value = data.hasMore
        loadingOlder.value = false
        clearTimeout(historyTimer)
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
          requestedBefore = ''
          historyError.value = data.message
          return
        }
        error.value = data.message
        errorCode.value = data.code
        if (data.clientMessageId) failMessage(data.clientMessageId, data.message, 'failed')
        if (status.value !== 'connected') {
          stopped = true
          status.value = 'error'
          joined.value = false
          activeCharacterId.value = null
          activeOrder.value = null
          messages.value = []
          hasOlder.value = false
          participants.value = []
          clearTimers()
          ws.close()
        }
      }
    }
    ws.onerror = () => { /* The close handler retries failed connections. */ }
    ws.onclose = () => {
      if (socket !== ws || stopped) return
      failPendingMessages('연결이 끊겨 전송 결과를 확인하지 못했습니다. 다시 보내면 중복될 수 있습니다.')
      clearTimers()
      loadingOlder.value = false
      clearTimeout(historyTimer)
      requestedBefore = ''
      status.value = 'reconnecting'
      error.value = '연결이 끊어졌습니다. 자동으로 다시 연결하고 있습니다.'
      reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15_000))
    }
  }

  function join(value: PartyCredentials) {
    failPendingMessages('전송 결과를 확인하지 못했습니다. 다시 보내면 중복될 수 있습니다.')
    clearTimers()
    const previous = socket
    socket = undefined
    previous?.close()
    stopped = false
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

  function send(text: string): boolean {
    const currentSocket = socket
    if (status.value !== 'connected' || currentSocket?.readyState !== WebSocket.OPEN || !text.trim() || text.trim().length > 1000) return false
    const self = participants.value.find(participant => participant.id === participantId.value)
    if (!self) return false
    const clientMessageId = crypto.randomUUID()
    const optimisticMessage: LocalPartyChatMessage = {
      kind: 'chat',
      id: clientMessageId,
      clientMessageId,
      participant: { ...self },
      text: text.trim(),
      createdAt: new Date().toISOString(),
      delivery: 'sending'
    }
    const next = [...messages.value, optimisticMessage]
    messages.value = loadedHistory ? next : next.slice(-PARTY_HISTORY_MAX_MESSAGES)
    error.value = ''
    try {
      currentSocket.send(JSON.stringify({ type: 'CHAT', text, clientMessageId }))
    } catch {
      failMessage(clientMessageId, '메시지를 보내지 못했습니다. 다시 시도해 주세요.', 'failed')
      error.value = '메시지를 보내지 못했습니다. 다시 시도해 주세요.'
      currentSocket.close()
      return true
    }
    sendTimers.set(clientMessageId, setTimeout(() => {
      if (!sendTimers.has(clientMessageId)) return
      failMessage(clientMessageId, '전송 확인이 지연되었습니다. 다시 보내면 중복될 수 있습니다.')
      error.value = '전송 확인이 지연되어 다시 연결합니다.'
      currentSocket.close()
    }, 10_000))
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

  onBeforeUnmount(() => {
    stopped = true
    clearTimers()
    for (const clientMessageId of sendTimers.keys()) clearSendTimer(clientMessageId)
    socket?.close(1000, 'leave-room')
    credentials = undefined
  })

  return { status, messages, participants, participantId, activeCharacterId, activeOrder, error, errorCode, joined, loadingOlder, hasOlder, historyError, join, send, takeLocalMessage, loadOlder, changeCharacter, changeOrder }
}
