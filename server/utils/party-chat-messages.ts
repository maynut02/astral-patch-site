import { randomUUID } from 'node:crypto'
import { PARTY_HISTORY_CURSOR_PATTERN, PARTY_ORDERS, PARTY_SPECTATOR_ID, type PartyChatMessage, type PartyJoinNotice, type PartyRoomMessage } from '../../shared/types/party.ts'
import type { PartyChatState } from './party-chat-state.ts'
import { PARTY_LIMITS } from './party-chat-limits.ts'
import type { PartyCharacterChangeResult, PartyChatInput, PartyChatResult, PartyJoinFailure, PartyOrderChangeResult, PartyPeer } from './party-chat-types.ts'

export function createPartyMessages(context: PartyChatState) {
  const { state, rooms, connections, appendRoomMessage, persistRoomMessage, isPartyCharacterId, isPartyOrder, queueRoomWrite, cloneParticipant, applyParticipantProfile, syncParticipantMessages, getParticipants, normalizePartyChatText, getTextLength, appendRoomMessageNow, normalizePartyRoomId } = context

  function recordPartyJoin(peer: PartyPeer): { notice: PartyJoinNotice, peers: PartyPeer[] } | null {
    const connection = connections.get(peer)
    if (!connection || connection.closed || !connection.room || !connection.participant) return null
    if (connection.suppressJoinNotice) {
      connection.suppressJoinNotice = false
      return null
    }

    const room = connection.room
    const participant = connection.participant
    const notice: PartyJoinNotice = {
      kind: 'join',
      id: randomUUID(),
      nickname: participant.nickname,
      createdAt: new Date().toISOString()
    }
    const peers = [...room.participants.keys()]
    // 방송은 저장을 기다리지 않지만, 채팅·퇴장과 같은 큐에 먼저 예약해 저장 순서를 지킨다.
    appendRoomMessage(room, notice)
    void persistRoomMessage(room, notice).catch(error => console.error('[party] Failed to save join notice', error))
    return { notice: { ...notice }, peers }
  }

  async function changePartyCharacter(peer: PartyPeer, characterId: unknown): Promise<PartyCharacterChangeResult> {
    const connection = connections.get(peer)
    if (!connection || connection.closed || !connection.room || !connection.participant) {
      return { ok: false, code: 'NOT_IN_ROOM', message: '방에 입장한 후 캐릭터를 변경할 수 있습니다.' }
    }
    if (!isPartyCharacterId(characterId)) {
      return { ok: false, code: 'INVALID_CHARACTER', message: '올바른 캐릭터를 선택해 주세요.' }
    }

    connection.lastSeenAt = Date.now()
    const room = connection.room
    const participant = connection.participant
    const acceptedConnection = connection
    return queueRoomWrite(room, async (): Promise<PartyCharacterChangeResult> => {
      // 인계 뒤 도착한 이전 연결의 프로필 작업은 현재 신원과 어긋나므로 적용하지 않는다.
      if (acceptedConnection.replacedByTakeover) {
        return { ok: false, code: 'NOT_IN_ROOM', message: '방에 입장한 후 캐릭터를 변경할 수 있습니다.' }
      }
      const updated = cloneParticipant(participant)
      updated.characterId = characterId
      if (characterId === PARTY_SPECTATOR_ID) updated.order = null
      else if (!updated.order) updated.order = PARTY_ORDERS[0]
      await state.store.updateParticipant(updated)
      // 저장이 끝났으면 연결이 끊겼어도 이미 승인된 객체는 갱신하되 실시간 상태는 되살리지 않는다.
      participant.characterId = updated.characterId
      participant.order = updated.order
      applyParticipantProfile(room, participant.id, updated)
      syncParticipantMessages(room, updated)
      return {
        ok: true,
        roomId: room.roomId,
        participants: getParticipants(room)
      }
    })
  }

  async function changePartyOrder(peer: PartyPeer, order: unknown): Promise<PartyOrderChangeResult> {
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
    const room = connection.room
    const participant = connection.participant
    const acceptedConnection = connection
    return queueRoomWrite(room, async (): Promise<PartyOrderChangeResult> => {
      // 인계 뒤 도착한 이전 연결의 프로필 작업은 현재 신원과 어긋나므로 적용하지 않는다.
      if (acceptedConnection.replacedByTakeover) {
        return { ok: false, code: 'NOT_IN_ROOM', message: '방에 입장한 후 순서를 변경할 수 있습니다.' }
      }
      if (participant.characterId === PARTY_SPECTATOR_ID) {
        return { ok: false, code: 'SPECTATOR_ORDER_DISABLED', message: '관전 중에는 순서를 선택할 수 없습니다.' }
      }
      const updated = { ...cloneParticipant(participant), order }
      await state.store.updateParticipant(updated)
      participant.order = order
      applyParticipantProfile(room, participant.id, updated)
      syncParticipantMessages(room, updated)
      return {
        ok: true,
        roomId: room.roomId,
        participants: getParticipants(room)
      }
    })
  }

  async function sendPartyChat(
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
    const room = connection.room
    // 참가자 객체를 붙잡아 큐에서 연결이 닫혀도 실제 승인된 발신자 정보를 유지한다.
    const participant = connection.participant
    const participantId = participant.id
    const effectiveClientMessageId = clientMessageId || randomUUID()
    const dedupeKey = clientMessageId ? `${participantId}:${clientMessageId}` : ''
    const createdAt = new Date(connection.lastSeenAt).toISOString()

    const peers = [...room.participants.keys()]
    const message = await queueRoomWrite(room, async () => {
      if (dedupeKey) {
        const existing = room.clientMessages.get(dedupeKey)
        if (existing) return existing
      }
      const created: PartyChatMessage = {
        kind: 'chat',
        id: randomUUID(),
        clientMessageId: effectiveClientMessageId,
        participant: cloneParticipant(participant),
        text,
        createdAt
      }
      const stored = await appendRoomMessageNow(room, created)
      if (stored.kind !== 'chat') throw new Error('Invalid stored chat message')
      return stored
    })

    // 저장 대기 중 나간 참가자와 큐 앞의 입장·재접속으로 들어온 참가자 모두에게 보낸다.
    const recipients = new Set(peers)
    for (const peer of room.participants.keys()) recipients.add(peer)

    return {
      ok: true,
      message: { ...message, participant: cloneParticipant(message.participant) },
      peers: [...recipients]
    }
  }

  async function getPartyHistory(peer: PartyPeer, before: unknown): Promise<{
    before: string
    messages: PartyRoomMessage[]
    hasMore: boolean
  } | PartyJoinFailure> {
    const connection = connections.get(peer)
    if (!connection?.room || !connection.participant || connection.closed) {
      return { ok: false, code: 'NOT_IN_ROOM', message: '방에 입장한 후 기록을 볼 수 있습니다.' }
    }
    if (typeof before !== 'string' || !PARTY_HISTORY_CURSOR_PATTERN.test(before)) {
      return { ok: false, code: 'INVALID_CURSOR', message: '올바르지 않은 기록 위치입니다.' }
    }
    const history = await state.store.getMessagesBefore(connection.room.sessionId, before, 50)
    return { before, ...history }
  }

  function getPartyRoomPeers(roomIdInput: unknown): PartyPeer[] {
    const roomId = normalizePartyRoomId(roomIdInput)
    if (!roomId) return []

    const room = rooms.get(roomId)
    return room ? [...room.participants.keys()] : []
  }

  return { recordPartyJoin, changePartyCharacter, changePartyOrder, sendPartyChat, getPartyHistory, getPartyRoomPeers }
}
