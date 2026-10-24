import { randomUUID } from 'node:crypto'
import { PARTY_CLOSE_LEAVE, PARTY_CLOSE_PAGE_HIDE, type PartyLeaveNotice, type PartyParticipant } from '../../shared/types/party.ts'
import type { PartyChatState } from './party-chat-state.ts'
import { PARTY_LIMITS } from './party-chat-limits.ts'
import type { PartyCloseDetails, PartyPeer, PartyPresenceUpdate, PartyRoom, PendingDeparture } from './party-chat-types.ts'

export function createPartyPresence(context: PartyChatState, maybeStopMaintenance: () => void) {
  const { state, rooms, connections, connectionLogs, logEvent, participantEvent, clearPendingTimer, cloneParticipant, queueRoomWrite, appendRoomMessageNow, getParticipants, releaseConnectionQuota, setEmptySince } = context

  function buildLeaveNotice(participant: PartyParticipant, now: number): PartyLeaveNotice {
    return {
      kind: 'leave',
      id: randomUUID(),
      nickname: participant.nickname,
      createdAt: new Date(now).toISOString()
    }
  }

  function publishLeave(notice: PartyLeaveNotice, roomId: string): void {
    if (state.shuttingDown) return
    state.presenceListener?.({
      roomId,
      notice: { ...notice }
    })
  }

  function publishParticipants(room: PartyRoom): void {
    if (state.shuttingDown) return
    state.presenceListener?.({
      roomId: room.roomId,
      participants: getParticipants(room)
    })
  }

  // 명시적 퇴장은 저장에 성공한 뒤에만 공지를 한 번 방송한다.
  async function finalizeLeave(room: PartyRoom, participant: PartyParticipant): Promise<void> {
    const notice = buildLeaveNotice(participant, Date.now())
    try {
      await queueRoomWrite(room, async () => {
        await appendRoomMessageNow(room, notice, participant.id)
        if (room.participants.size === 0 && room.pendingDepartures.size === 0) {
          // 만료 시각은 이벤트 시각이 아니라 현재 시계로 계산한다.
          await state.store.setRoomExpiry(
            room.sessionId,
            new Date(Date.now() + PARTY_LIMITS.emptyRoomTtlMs).toISOString()
          ).catch(error => console.error('[party] Failed to shorten empty room expiry', error))
        }
      })
    } catch (error) {
      console.error('[party] Failed to save leave notice', error)
      return
    }

    publishLeave(notice, room.roomId)
    logEvent({ event: 'leave_notice', ...participantEvent(room, participant), departure: 'leave' })
  }

  function scheduleDepartureTimer(pending: PendingDeparture, delayMs: number, onExpire: () => void): void {
    if (pending.timer) clearTimeout(pending.timer)
    const timer = setTimeout(onExpire, Math.max(0, delayMs))
    timer.unref?.()
    pending.timer = timer
  }

  function reservePendingDeparture(
    room: PartyRoom,
    participant: PartyParticipant,
    reconnectTokenHash: string,
    now: number,
    expiresAt: number,
    departure: PendingDeparture['departure'],
    restored = false
  ): PendingDeparture {
    const existing = room.pendingDepartures.get(participant.id)
    if (existing) clearPendingTimer(existing)

    room.departureGeneration += 1
    const generation = room.departureGeneration
    const pending: PendingDeparture = {
      participant: cloneParticipant(participant),
      reconnectTokenHash,
      departure,
      restored,
      disconnectedAt: now,
      expiresAt,
      generation
    }
    room.pendingDepartures.set(participant.id, pending)
    if (expiresAt <= Date.now()) {
      expirePendingDeparture(room, participant.id, generation)
      return pending
    }
    scheduleDepartureTimer(pending, pending.expiresAt - Date.now(), () => {
      expirePendingDeparture(room, participant.id, generation)
    })
    return pending
  }

  // 만료와 재연결은 같은 큐에서 직렬화되고, 늦게 도착한 타이머는 세대 검사로 무시된다.
  function expirePendingDeparture(room: PartyRoom, participantId: string, generation: number): void {
    void queueRoomWrite(room, async () => {
      if (state.shuttingDown) return
      if (rooms.get(room.roomId) !== room) return
      const pending = room.pendingDepartures.get(participantId)
      if (!pending || pending.generation !== generation) return

      const currentNow = Date.now()
      if (currentNow < pending.expiresAt) {
        scheduleDepartureTimer(pending, pending.expiresAt - currentNow, () => {
          expirePendingDeparture(room, participantId, generation)
        })
        return
      }

      room.pendingDepartures.delete(participantId)
      clearPendingTimer(pending)
      setEmptySince(room, currentNow)
      const notice = buildLeaveNotice(pending.participant, currentNow)
      try {
        await appendRoomMessageNow(room, notice, pending.participant.id)
      } catch (error) {
        console.error('[party] Failed to save leave notice', error)
        return
      }

      publishLeave(notice, room.roomId)
      logEvent({ event: 'leave_notice', ...participantEvent(room, pending.participant), departure: pending.departure })
      maybeStopMaintenance()
    }).catch(error => console.error('[party] Failed to expire pending departure', error))
  }

  async function removePartyConnection(
    peer: PartyPeer,
    now = Date.now(),
    details: PartyCloseDetails | 'loss' | 'leave' = 'loss'
  ): Promise<void> {
    const close: PartyCloseDetails = typeof details === 'string'
      ? details === 'leave' ? PARTY_CLOSE_LEAVE : {}
      : details
    const connection = connections.get(peer)
    const logState = connectionLogs.get(peer)
    const departure = state.shuttingDown
      ? 'shutdown'
      : logState?.replaced
        ? 'replaced'
        : !connection?.participant
            ? 'not-joined'
            : close.code === PARTY_CLOSE_LEAVE.code && close.reason === PARTY_CLOSE_LEAVE.reason
              ? 'leave'
              : close.code === 1001 || (close.code === PARTY_CLOSE_PAGE_HIDE.code && close.reason === PARTY_CLOSE_PAGE_HIDE.reason)
                ? 'page-hide'
                : 'loss'
    if (logState && !logState.disconnected) {
      logState.disconnected = true
      logEvent({
        event: 'disconnect', roomId: logState.roomId, sessionId: logState.sessionId,
        participantId: logState.participantId, nickname: logState.nickname, connectionId: peer.id,
        closeCode: close.code, closeReason: close.reason, departure,
        connectedMs: Math.min(2_147_483_647, Math.max(0, now - logState.openedAt)),
        detail: { ...(close.serverReason || logState.replaced ? { serverReason: close.serverReason ?? 'replaced-by-reconnect' } : {}) }
      })
    }
    if (!connection) return

    connection.closed = true
    connections.delete(peer)
    releaseConnectionQuota(connection)

    const room = connection.room
    const participant = connection.participant
    connection.room = undefined
    connection.participant = undefined

    if (!room || !participant) {
      maybeStopMaintenance()
      return
    }

    room.participants.delete(peer)
    if (state.shuttingDown) return
    // 빈 방 TTL도 이벤트 시각이 아니라 현재 시계에서 시작한다.
    setEmptySince(room, Date.now())

    if (departure === 'leave') {
      const pending = room.pendingDepartures.get(participant.id)
      if (pending) {
        clearPendingTimer(pending)
        room.pendingDepartures.delete(participant.id)
      }
      // 참가자 목록은 저장을 기다리지 않고 즉시 알리고, 퇴장 공지는 저장 성공 뒤 한 번만 보낸다.
      publishParticipants(room)
      await finalizeLeave(room, participant)
      maybeStopMaintenance()
      return
    }

    // heartbeat 만료도 감지 시점부터 유예한다. 마지막 수신 시각을 기준으로 하면 감지 순간 유예가 이미 끝나,
    // 클라이언트가 조용한 단절을 알아채고 다시 붙기 전에 토큰이 무효화된다.
    const deadline = now + (departure === 'page-hide' ? PARTY_LIMITS.pageHideGraceMs : PARTY_LIMITS.connectionLossGraceMs)
    const pending = reservePendingDeparture(room, participant, participant.reconnectTokenHash, now, deadline, departure === 'page-hide' ? 'page-hide' : 'loss')
    const write = queueRoomWrite(room, async () => {
      if (state.shuttingDown) return
      if (room.pendingDepartures.get(participant.id) !== pending) return
      await state.store.setDepartureDeadline(participant.id, new Date(deadline).toISOString())
    })
    publishParticipants(room)
    await write
    maybeStopMaintenance()
  }

  function setPartyPresenceListener(
    listener: ((update: PartyPresenceUpdate) => void) | undefined
  ): void {
    state.presenceListener = listener
  }

  return { reservePendingDeparture, removePartyConnection, setPartyPresenceListener }
}
