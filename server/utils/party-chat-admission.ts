import { randomUUID } from 'node:crypto'
import { PARTY_ORDERS, PARTY_SPECTATOR_ID, type PartyParticipant } from '../../shared/types/party.ts'
import type { PartyChatState } from './party-chat-state.ts'
import { PARTY_LIMITS } from './party-chat-limits.ts'
import type { PartyJoinFailure, PartyJoinInput, PartyJoinResult, PartyPeer, PartyRoom } from './party-chat-types.ts'

export function createPartyAdmission(context: PartyChatState, findPartyRoom: (roomId: string) => Promise<PartyRoom | null>) {
  const { state, rooms, connections, connectionLogs, logEvent, participantEvent, sanitizeDiagnostics, normalizePartyRoomId, normalizePartyNickname, isPartyCharacterId, isPartyOrder, normalizeReconnectToken, findReconnectOwner, nicknameKey, consumeJoinAttempt, isPartyNicknameTaken, hashReconnectToken, releaseConnectionQuota, clearPendingTimer, syncParticipantMessages, setEmptySince, queueRoomWrite, getRoomSummary, cloneMessage, getParticipants } = context

  interface PersistedAdmission {
    id: string
    // 이미 있던 신원(재개)인지, 이번 입장에서 새로 만든 신원인지
    existing: boolean
  }

  // 저장 뒤 취소된 입장: 새 신원은 재시작 후 복원되지 않게 닫고, 유예 중인 기존 신원은 마감 시각을 다시 기록한다.
  async function revertAdmission(room: PartyRoom, persisted: PersistedAdmission[]): Promise<void> {
    try {
      for (const entry of persisted) {
        if (!entry.existing) {
          await state.store.discardParticipant(entry.id)
          continue
        }
        const pending = room.pendingDepartures.get(entry.id)
        if (pending) await state.store.setDepartureDeadline(entry.id, new Date(pending.expiresAt).toISOString())
      }
    } catch (error) {
      console.error('[party] Failed to revert cancelled admission', error)
    }
  }

  async function joinPartyRoom(peer: PartyPeer, input: PartyJoinInput): Promise<PartyJoinResult> {
    let result: PartyJoinResult
    try {
      result = await admitPartyParticipant(peer, input)
    } catch (error) {
      logEvent({ event: 'join_rejected', connectionId: peer.id, roomId: normalizePartyRoomId(input.roomId) ?? undefined, detail: { code: 'STORAGE_UNAVAILABLE' } })
      throw error
    }
    if (!result.ok) logEvent({ event: 'join_rejected', connectionId: peer.id, roomId: normalizePartyRoomId(input.roomId) ?? undefined, detail: { code: result.code } })
    return result
  }

  async function admitPartyParticipant(
    peer: PartyPeer,
    input: PartyJoinInput
  ): Promise<PartyJoinResult> {
    const connection = connections.get(peer)
    if (!connection || connection.closed) {
      return {
        ok: false,
        code: 'CONNECTION_CLOSED',
        message: '웹소켓 연결을 사용할 수 없습니다.'
      }
    }

    if (connection.joining || connection.room || connection.participant) {
      return {
        ok: false,
        code: 'ALREADY_JOINED',
        message: '이 연결은 이미 방에 입장했습니다.'
      }
    }

    const roomId = normalizePartyRoomId(input.roomId)
    if (!roomId) {
      return {
        ok: false,
        code: 'INVALID_ROOM_ID',
        message: '방 번호는 숫자 6자리여야 합니다.'
      }
    }

    const nickname = normalizePartyNickname(input.nickname)
    if (!nickname) {
      return {
        ok: false,
        code: 'INVALID_NICKNAME',
        message: `닉네임은 1~${PARTY_LIMITS.maxNicknameLength}자여야 합니다.`
      }
    }

    if (!isPartyCharacterId(input.characterId)) {
      return {
        ok: false,
        code: 'INVALID_CHARACTER',
        message: '캐릭터를 선택해 주세요.'
      }
    }

    if (input.characterId === PARTY_SPECTATOR_ID && input.order != null) {
      return { ok: false, code: 'SPECTATOR_ORDER_DISABLED', message: '관전 중에는 순서를 선택할 수 없습니다.' }
    }
    if (input.characterId !== PARTY_SPECTATOR_ID && input.order !== undefined && !isPartyOrder(input.order)) {
      return { ok: false, code: 'INVALID_ORDER', message: '올바른 순서를 선택해 주세요.' }
    }

    const providedToken = normalizeReconnectToken(input.reconnectToken)
    const now = Date.now()
    const existingRoom = rooms.get(roomId)
    const memoryOwner = providedToken && existingRoom ? findReconnectOwner(existingRoom, providedToken, now) : null
    const rateExempt = Boolean(
      memoryOwner && nicknameKey(memoryOwner.participant.nickname) === nicknameKey(nickname)
    )
    if (!rateExempt) {
      const attempt = consumeJoinAttempt(connection.ipAddress, now)
      if (!attempt.allowed) {
        return {
          ok: false,
          code: 'JOIN_RATE_LIMITED',
          message: '입장 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
          retryAfterMs: attempt.retryAfterMs
        }
      }
    }

    connection.joining = true
    try {
      const room = await findPartyRoom(roomId)
      if (!room) {
        return {
          ok: false,
          code: 'ROOM_NOT_FOUND',
          message: '방을 찾을 수 없습니다.'
        }
      }

      if (connection.closed || connection.room || connection.participant) {
        return {
          ok: false,
          code: 'CONNECTION_CLOSED',
          message: '웹소켓 연결을 사용할 수 없습니다.'
        }
      }

      const desiredOrder = input.characterId === PARTY_SPECTATOR_ID
        ? null
        : isPartyOrder(input.order) ? input.order : PARTY_ORDERS[0]
      const desiredCharacterId = input.characterId
      let participant: PartyParticipant = {
        id: randomUUID(),
        nickname,
        characterId: desiredCharacterId,
        order: desiredOrder
      }
      let reconnectToken: string = randomUUID()
      let replacedPeer: PartyPeer | undefined
      let resumed = false
      let suppressJoinNotice = false
      let conflict: PartyJoinFailure | null = null
      let roomLost = false
      let restored = false
      let disconnectedMs: number | undefined

      // 저장 뒤 입장이 취소되면 같은 큐 안에서 DB 상태를 되돌리기 위해 저장한 신원을 기록한다.
      const persisted: PersistedAdmission[] = []
      const admitInQueue = async (): Promise<boolean> => {
        const isCurrentConnection = () => !connection.closed && !connection.room && !connection.participant
        // 방이 정리/교체됐으면 어떤 저장도 그 방에 반영하지 않는다.
        if (!isCurrentConnection()) return false
        if (rooms.get(room.roomId) !== room) {
          roomLost = true
          return false
        }

        const serializedNow = Date.now()
        const owner = providedToken ? findReconnectOwner(room, providedToken, serializedNow) : null
        const matchedOwner = owner && nicknameKey(owner.participant.nickname) === nicknameKey(nickname)
          ? owner
          : undefined

        // 이번 입장이 새 예산을 이미 소모했는지 추적해 중복 소모를 막는다.
        let budgetConsumed = false
        const consumeBudgetOnce = (now: number): boolean => {
          if (budgetConsumed) return true
          budgetConsumed = true
          const attempt = consumeJoinAttempt(connection.ipAddress, now)
          if (attempt.allowed) return true
          conflict = {
            ok: false,
            code: 'JOIN_RATE_LIMITED',
            message: '입장 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
            retryAfterMs: attempt.retryAfterMs
          }
          return false
        }

        // 유효 토큰 예외가 사라졌다면 이번 입장은 새 예산을 정확히 한 번 소모한다.
        if (!matchedOwner && rateExempt && !consumeBudgetOnce(serializedNow)) return false

        if (isPartyNicknameTaken(roomId, nickname, matchedOwner?.participant.id)) {
          const pending = [...room.pendingDepartures.values()]
            .find(departure => Date.now() < departure.expiresAt
              && departure.participant.id !== matchedOwner?.participant.id
              && nicknameKey(departure.participant.nickname) === nicknameKey(nickname))
          conflict = pending
            ? {
                ok: false,
                code: 'NICKNAME_TAKEN',
                message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.',
                retryAfterMs: Math.max(0, pending.expiresAt - serializedNow)
              }
            : {
                ok: false,
                code: 'NICKNAME_TAKEN',
                message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.'
              }
          return false
        }

        // 저장 전에 붙잡은 신원은 await 뒤에 다시 검증해야 한다.
        const resumeParticipantId = matchedOwner?.participant.id
        const resumeToken = matchedOwner ? providedToken : null

        if (matchedOwner) {
          participant = {
            id: matchedOwner.participant.id,
            nickname,
            characterId: desiredCharacterId,
            order: desiredOrder
          }
        }
        reconnectToken = matchedOwner && providedToken ? providedToken : reconnectToken
        await state.store.upsertParticipant(room.sessionId, participant, hashReconnectToken(reconnectToken))
        persisted.push({ id: participant.id, existing: Boolean(matchedOwner) })

        await state.store.extendRoom(room.sessionId, new Date(Date.now() + PARTY_LIMITS.emptyRoomTtlMs).toISOString())

        if (rooms.get(room.roomId) !== room) {
          roomLost = true
          return false
        }
        if (!isCurrentConnection()) return false

        if (resumeParticipantId) {
          // 재개 신원이 저장 대기 중 명시적으로 무효화됐는지만 확인한다. 저장 시간 때문에 유예 마감을 넘긴 것은 무효화가 아니다.
          const currentOwner = resumeToken ? findReconnectOwner(room, resumeToken, Date.now(), true) : null
          if (!currentOwner || currentOwner.participant.id !== resumeParticipantId) {
            // 무효화된 신원을 되살리지 않고 새 참가자로 다시 시작한다.
            if (isPartyNicknameTaken(roomId, nickname)) {
              const pending = [...room.pendingDepartures.values()]
                .find(departure => Date.now() < departure.expiresAt
                  && nicknameKey(departure.participant.nickname) === nicknameKey(nickname))
              conflict = {
                ok: false,
                code: 'NICKNAME_TAKEN',
                message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.',
                ...(pending ? { retryAfterMs: Math.max(0, pending.expiresAt - Date.now()) } : {})
              }
              return false
            }

            // 무효화된 신원을 되살리지 않고, 새 예산을 한 번 소모한 뒤 새 참가자로 다시 시작한다.
            if (!consumeBudgetOnce(Date.now())) return false
            resumed = false
            suppressJoinNotice = false
            participant = {
              id: randomUUID(),
              nickname,
              characterId: desiredCharacterId,
              order: desiredOrder
            }
            reconnectToken = randomUUID()
            await state.store.upsertParticipant(room.sessionId, participant, hashReconnectToken(reconnectToken))
            persisted.push({ id: participant.id, existing: false })
            if (rooms.get(room.roomId) !== room) {
              roomLost = true
              return false
            }
            if (!isCurrentConnection()) return false
          } else {
            resumed = true
            reconnectToken = resumeToken ?? reconnectToken
            participant = {
              id: currentOwner.participant.id,
              nickname,
              characterId: desiredCharacterId,
              order: desiredOrder
            }
          }
        }

        for (const [activePeer, activeConn] of room.participants) {
          if (activeConn.participant?.id === participant.id && activePeer !== peer) {
            const oldLog = connectionLogs.get(activePeer)
            if (oldLog) oldLog.replaced = true
            activeConn.room = undefined
            activeConn.participant = undefined
            activeConn.closed = true
            activeConn.replacedByTakeover = true
            room.participants.delete(activePeer)
            // 이전 연결은 즉시 종료된 것으로 보고 쿼터를 바로 반환한다.
            connections.delete(activePeer)
            releaseConnectionQuota(activeConn)
            replacedPeer = activePeer
            suppressJoinNotice = true
            break
          }
        }

        // 유예 예약을 되살릴 때는 타이머를 취소해 저장 대기 중 만료가 끼어들지 않게 한다.
        const pendingDeparture = room.pendingDepartures.get(participant.id)
        if (pendingDeparture) {
          restored = pendingDeparture.restored
          disconnectedMs = Math.max(0, Date.now() - pendingDeparture.disconnectedAt)
          clearPendingTimer(pendingDeparture)
          room.pendingDepartures.delete(participant.id)
        }

        connection.room = room
        connection.participant = Object.assign(participant, { reconnectTokenHash: hashReconnectToken(reconnectToken) })
        // 재연결은 이전 연결이 살아 있든 유예 중이든 입·퇴장 공지를 모두 억제한다.
        connection.suppressJoinNotice = resumed || suppressJoinNotice
        room.participants.set(peer, connection)
        const connectionLog = connectionLogs.get(peer)
        if (connectionLog) Object.assign(connectionLog, participantEvent(room, participant))
        syncParticipantMessages(room, participant)
        setEmptySince(room, Date.now())
        return true
      }
      const admitted = await queueRoomWrite(room, async () => {
        let ok = false
        try {
          ok = await admitInQueue()
        } finally {
          if (!ok && persisted.length > 0) await revertAdmission(room, persisted)
        }
        return ok
      })

      if (replacedPeer) {
        try {
          replacedPeer.close(1000, 'replaced-by-reconnect')
        } catch {
          // The previous socket may already be closed.
        }
      }

      if (!admitted) {
        if (conflict) return conflict
        if (roomLost) {
          return {
            ok: false,
            code: 'ROOM_NOT_FOUND',
            message: '방을 찾을 수 없습니다.'
          }
        }
        return connection.closed
          ? { ok: false, code: 'CONNECTION_CLOSED', message: '웹소켓 연결을 사용할 수 없습니다.' }
          : { ok: false, code: 'NICKNAME_TAKEN', message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.' }
      }

      logEvent({
        event: 'join', ...participantEvent(room, participant), connectionId: peer.id,
        detail: { resumed, restored, ...(disconnectedMs === undefined ? {} : { disconnectedMs }), diagnostics: sanitizeDiagnostics(input.diagnostics) }
      })
      return {
        ok: true,
        sessionId: room.sessionId,
        participantId: participant.id,
        reconnectToken,
        resumed,
        room: getRoomSummary(room),
        messages: room.messages.map(cloneMessage),
        participants: getParticipants(room)
      }
    } finally {
      connection.joining = false
    }
  }

  return { joinPartyRoom }
}
