import assert from 'node:assert/strict'
import test from 'node:test'
import { canResumePartyParticipant, changePartyCharacter, changePartyOrder, createPartyRoom, getPartyHistory, getPartyRoom, isPartyCharacterId, isPartyNicknameTaken, joinPartyRoom, normalizePartyNickname, normalizePartyRoomId, recordPartyJoin, registerPartyConnection, removePartyConnection, sendPartyChat, setPartyChatStore, setPartyPresenceListener, touchPartyConnection } from '../server/utils/party-chat.ts'
import { PARTY_LIMITS } from '../server/utils/party-chat-limits.ts'
import { PARTY_CHARACTER_IDS, PARTY_MAX_NICKNAME_LENGTH, PARTY_MAX_TEXT_LENGTH, PARTY_ORDERS, PARTY_UNSELECTED_ID, getPartyCharacterImage, getPartyTextLength } from '../shared/types/party.ts'

// node --experimental-strip-types scripts/test-party-rooms.mjs
const storedRooms = new Map()
const storedSessions = new Map()
const storedParticipants = new Map()
const connectionEvents = []
function activeParticipants(sessionId) {
  return [...storedParticipants.values()]
    .filter(participant => participant.sessionId === sessionId && participant.leftAt === null && participant.reconnectTokenHash != null)
    .map(participant => structuredClone(participant))
}
function storedMessage(message) {
  if (message.kind !== 'chat') return structuredClone(message)
  const participant = storedParticipants.get(message.participant.id) || message.participant
  return { ...structuredClone(message), participant: { id: participant.id, nickname: participant.nickname, characterId: participant.characterId, order: participant.order } }
}
const memoryStore = {
  async openRoom(roomId, sessionId, createdAt, expiresAt) {
    let room = storedRooms.get(roomId)
    if (!room || Date.parse(room.expiresAt) <= Date.parse(createdAt)) {
      if (room) storedSessions.delete(room.sessionId)
      room = { roomId, sessionId, createdAt, expiresAt, messages: [] }
      storedRooms.set(roomId, room)
      storedSessions.set(sessionId, room)
    }
    return { sessionId: room.sessionId, createdAt: room.createdAt, emptySinceMs: Date.parse(room.expiresAt) - PARTY_LIMITS.emptyRoomTtlMs, messages: room.messages.slice(-300).map(storedMessage), participants: activeParticipants(room.sessionId) }
  },
  async findRoom(roomId) {
    const room = storedRooms.get(roomId)
    if (!room || Date.parse(room.expiresAt) <= Date.now()) return null
    return { sessionId: room.sessionId, createdAt: room.createdAt, emptySinceMs: Date.parse(room.expiresAt) - PARTY_LIMITS.emptyRoomTtlMs, messages: room.messages.slice(-300).map(storedMessage), participants: activeParticipants(room.sessionId) }
  },
  async upsertParticipant(sessionId, participant, reconnectTokenHash) {
    storedParticipants.set(participant.id, { ...structuredClone(participant), sessionId, reconnectTokenHash, departureDeadline: null, leftAt: null })
  },
  async updateParticipant(participant) { Object.assign(storedParticipants.get(participant.id), structuredClone(participant)) },
  async setDepartureDeadline(participantId, deadline) { storedParticipants.get(participantId).departureDeadline = deadline },
  async discardParticipant(participantId) { storedParticipants.get(participantId).leftAt = new Date().toISOString() },
  async appendMessage(sessionId, message, leftParticipantId) {
    const room = storedSessions.get(sessionId)
    const existing = room.messages.find(candidate => candidate.id === message.id || (candidate.kind === 'chat' && message.kind === 'chat' && candidate.participant.id === message.participant.id && candidate.clientMessageId === message.clientMessageId))
    if (existing) return storedMessage(existing)
    if (leftParticipantId) Object.assign(storedParticipants.get(leftParticipantId), { leftAt: message.createdAt, departureDeadline: null })
    room.messages.push(structuredClone(message))
    return storedMessage(message)
  },
  async getMessagesBefore(sessionId, beforeId, limit) {
    const all = storedSessions.get(sessionId).messages
    const before = all.findIndex(message => message.id === beforeId)
    const earlier = before < 0 ? [] : all.slice(Math.max(0, before - limit), before).map(storedMessage)
    return { messages: earlier, hasMore: before > limit }
  },
  async extendRoom(sessionId, expiresAt) {
    const room = storedSessions.get(sessionId)
    if (room && room.expiresAt < expiresAt) room.expiresAt = expiresAt
  },
  async setRoomExpiry(sessionId, expiresAt) {
    const room = storedSessions.get(sessionId)
    if (room) room.expiresAt = expiresAt
  },
  async deleteRoom(sessionId) {
    const room = storedSessions.get(sessionId)
    if (room) storedRooms.delete(room.roomId)
    storedSessions.delete(sessionId)
  },
  async deleteExpiredRooms() {},
  async recordConnectionEvent(event) { connectionEvents.push(structuredClone(event)) },
  async deleteOldConnectionEvents() {}
}
setPartyChatStore(memoryStore)

const presenceUpdates = []
setPartyPresenceListener(update => presenceUpdates.push(update))

function takePresence() {
  return presenceUpdates.splice(0, presenceUpdates.length)
}

function leaveNotices(updates) {
  return updates.flatMap(update => update.notice ? [update.notice] : [])
}

test('room IDs require six ASCII digits and preserve leading zeros', async () => {
  for (const value of ['000000', '001234', '123456', '999999']) {
    assert.equal(normalizePartyRoomId(value), value)
  }
  assert.equal(normalizePartyRoomId(' 001234 '), '001234')
  for (const value of ['', '12345', '1234567', '12a456', '12_456', '１２３４５６', 123456, null]) {
    assert.equal(normalizePartyRoomId(value), null)
    assert.equal((await createPartyRoom(value)).ok, false)
  }
})

test('entering an ID creates or returns the same room, and idle rooms expire', async (t) => {
  assert.equal(PARTY_LIMITS.emptyRoomTtlMs, 3 * 60_000)
  const startedAt = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: startedAt })
  const pings = []
  const participant = {
    id: 'member',
    send() {},
    websocket: {
      ping(payload) {
        pings.push(payload)
      }
    },
    close() {}
  }
  t.after(() => removePartyConnection(participant))

  const created = await createPartyRoom('001234')
  const firstSessionId = storedRooms.get('001234').sessionId
  assert.equal(created.ok, true)
  assert.deepEqual(Object.keys(created.room).sort(), ['createdAt', 'participantCount', 'roomId'])
  assert.equal(created.room.participantCount, 0)
  assert.deepEqual(await createPartyRoom('001234'), created)

  assert.equal(registerPartyConnection(participant, 'local-member'), true)
  const joined = await joinPartyRoom(participant, { roomId: '001234', nickname: '파티원', characterId: '101' })
  assert.equal(joined.ok, true)
  assert.equal(getPartyRoom('001234')?.participantCount, 1)
  assert.equal((await createPartyRoom('001234')).room.participantCount, 1)

  for (let count = 1; count <= 4; count++) {
    t.mock.timers.tick(PARTY_LIMITS.heartbeatIntervalMs)
    assert.equal(pings.length, count)
    assert.equal(pings.at(-1), 'party-presence')
    assert.equal(touchPartyConnection(participant), true)
  }
  assert.equal(getPartyRoom('001234')?.participantCount, 1)

  t.mock.timers.setTime(Date.now() + PARTY_LIMITS.heartbeatTimeoutMs + 1)
  t.mock.timers.tick(PARTY_LIMITS.heartbeatIntervalMs)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(getPartyRoom('001234')?.participantCount, 0)
  // heartbeat 만료 뒤에도 재접속 유예가 끝나야 방이 비고 TTL이 시작된다.
  t.mock.timers.tick(PARTY_LIMITS.connectionLossGraceMs)
  for (let flush = 0; flush < 5; flush++) await new Promise(resolve => setImmediate(resolve))

  const emptiedAt = Date.now()
  t.mock.timers.setTime(emptiedAt + PARTY_LIMITS.emptyRoomTtlMs - 1)
  assert.equal(getPartyRoom('001234')?.participantCount, 0)
  t.mock.timers.setTime(emptiedAt + PARTY_LIMITS.emptyRoomTtlMs)
  assert.equal(getPartyRoom('001234'), null)
  const recreated = await createPartyRoom('001234')
  assert.equal(recreated.ok, true)
  assert.notEqual(recreated.room.createdAt, created.room.createdAt)
  assert.notEqual(storedRooms.get('001234').sessionId, firstSessionId)
  assert.equal(storedSessions.has(firstSessionId), false)
})

test('unknown room IDs still count against the join attempt limit', async (t) => {
  const peer = { id: 'guesser', send() {}, close() {} }
  assert.equal(registerPartyConnection(peer, 'local-guesser'), true)
  t.after(() => removePartyConnection(peer))
  const input = { roomId: '654321', nickname: '방문자', characterId: '101' }
  for (let index = 0; index < PARTY_LIMITS.maxJoinAttemptsPerIp; index++) {
    assert.equal((await joinPartyRoom(peer, input)).code, 'ROOM_NOT_FOUND')
  }
  assert.equal((await joinPartyRoom(peer, input)).code, 'JOIN_RATE_LIMITED')
})

test('join notices are kept in order with chat messages', async (t) => {
  const first = { id: 'first-join-notice', send() {}, close() {} }
  const second = { id: 'second-join-notice', send() {}, close() {} }
  assert.equal((await createPartyRoom('445566')).ok, true)
  assert.equal(registerPartyConnection(first, 'first-join-notice'), true)
  assert.equal(registerPartyConnection(second, 'second-join-notice'), true)
  t.after(async () => {
    await removePartyConnection(first)
    await removePartyConnection(second)
  })

  assert.equal((await joinPartyRoom(first, { roomId: '445566', nickname: '앨리스', characterId: '101' })).ok, true)
  const firstNotice = await recordPartyJoin(first)
  assert.equal(firstNotice?.notice.nickname, '앨리스')
  assert.deepEqual(firstNotice?.peers, [first])
  assert.equal(await recordPartyJoin(second), null)
  assert.equal((await sendPartyChat(first, { text: '안녕하세요' })).ok, true)

  const secondJoin = await joinPartyRoom(second, { roomId: '445566', nickname: '밥', characterId: '101' })
  assert.equal(secondJoin.ok, true)
  assert.deepEqual(secondJoin.messages.map(message => message.kind), ['join', 'chat'])
  assert.equal(secondJoin.messages[0].nickname, '앨리스')
  const secondNotice = await recordPartyJoin(second)
  assert.equal(secondNotice?.notice.nickname, '밥')
  assert.deepEqual(secondNotice?.peers, [first, second])

  const reader = { id: 'notice-reader', send() {}, close() {} }
  assert.equal(registerPartyConnection(reader, 'notice-reader'), true)
  t.after(() => removePartyConnection(reader))
  const history = await joinPartyRoom(reader, { roomId: '445566', nickname: '방문자', characterId: '101' })
  assert.equal(history.ok, true)
  assert.deepEqual(history.messages.map(message => message.kind), ['join', 'chat', 'join'])
  assert.deepEqual(history.messages.filter(message => message.kind === 'join').map(message => message.nickname), ['앨리스', '밥'])
})

test('room history respects message and byte limits', async (t) => {
  const sender = { id: 'history-limit-sender', send() {}, close() {} }
  const firstReader = { id: 'history-limit-first-reader', send() {}, close() {} }
  const secondReader = { id: 'history-limit-second-reader', send() {}, close() {} }
  t.after(async () => {
    await removePartyConnection(sender)
    await removePartyConnection(firstReader)
    await removePartyConnection(secondReader)
  })

  assert.equal((await createPartyRoom('778899')).ok, true)
  assert.equal(registerPartyConnection(sender, 'history-limit-sender'), true)
  assert.equal((await joinPartyRoom(sender, { roomId: '778899', nickname: '작성자', characterId: '101' })).ok, true)

  for (let index = 0; index < PARTY_LIMITS.historyLimit + 5; index++) {
    assert.equal((await sendPartyChat(sender, { text: `short-${index}` })).ok, true)
  }

  assert.equal(registerPartyConnection(firstReader, 'history-limit-first-reader'), true)
  const firstHistory = await joinPartyRoom(firstReader, { roomId: '778899', nickname: '첫 독자', characterId: '101' })
  assert.equal(firstHistory.ok, true)
  assert.equal(firstHistory.messages.length, PARTY_LIMITS.historyLimit)
  assert.equal(firstHistory.messages[0].text, 'short-5')
  assert.equal((await changePartyCharacter(sender, '306')).ok, true)
  const earlier = await getPartyHistory(firstReader, firstHistory.messages[0].id)
  assert.equal(earlier.messages.length, 5)
  assert.deepEqual(earlier.messages.map(message => message.text), ['short-0', 'short-1', 'short-2', 'short-3', 'short-4'])
  assert.ok(earlier.messages.every(message => message.participant.characterId === '306'))

  const longText = '가'.repeat(PARTY_MAX_TEXT_LENGTH)
  for (let index = 0; index < 100; index++) {
    assert.equal((await sendPartyChat(sender, { text: longText })).ok, true)
  }

  assert.equal(registerPartyConnection(secondReader, 'history-limit-second-reader'), true)
  const secondHistory = await joinPartyRoom(secondReader, { roomId: '778899', nickname: '둘째 독자', characterId: '101' })
  assert.equal(secondHistory.ok, true)
  assert.ok(secondHistory.messages.length < 100)
  assert.ok(secondHistory.messages.every(message => message.kind === 'chat' && message.text === longText))
  assert.ok(Buffer.byteLength(JSON.stringify(secondHistory.messages), 'utf8') <= PARTY_LIMITS.historyMaxBytes + 1)
  const olderPage = await getPartyHistory(secondReader, secondHistory.messages[0].id)
  assert.equal(olderPage.messages.length, 50)
  assert.equal(olderPage.hasMore, true)
  assert.equal(olderPage.messages.at(-1).text, longText)
  assert.ok(olderPage.messages.some(message => message.text === 'short-304'))
})

test('nicknames are unique within a room and released by an intentional leave', async (t) => {
  const first = { id: 'nickname-first', send() {}, close() {} }
  const second = { id: 'nickname-second', send() {}, close() {} }
  const third = { id: 'nickname-third', send() {}, close() {} }
  for (const peer of [first, second, third]) {
    assert.equal(registerPartyConnection(peer, peer.id), true)
    t.after(async () => {
      await removePartyConnection(peer, Date.now(), 'leave')
    })
  }
  assert.equal((await createPartyRoom('334455')).ok, true)
  assert.equal((await createPartyRoom('334456')).ok, true)
  takePresence()

  assert.equal((await joinPartyRoom(first, { roomId: '334455', nickname: 'Alice', characterId: '101' })).ok, true)
  assert.equal(isPartyNicknameTaken('334455', 'ａｌｉｃｅ'), true)
  assert.equal(isPartyNicknameTaken('334455', 'Bob'), false)
  assert.equal(isPartyNicknameTaken('334456', 'Alice'), false)
  const duplicate = await joinPartyRoom(second, { roomId: '334455', nickname: 'ＡＬＩＣＥ', characterId: '101' })
  assert.equal(duplicate.code, 'NICKNAME_TAKEN')
  assert.equal(duplicate.retryAfterMs, undefined)
  assert.equal(getPartyRoom('334455')?.participantCount, 1)
  assert.equal((await joinPartyRoom(second, { roomId: '334456', nickname: 'alice', characterId: '101' })).ok, true)

  await removePartyConnection(first, Date.now(), 'leave')
  const notices = leaveNotices(takePresence())
  assert.equal(notices.length, 1)
  assert.equal(notices[0].kind, 'leave')
  assert.equal(notices[0].nickname, 'Alice')
  assert.equal(isPartyNicknameTaken('334455', 'alice'), false)
  await removePartyConnection(first, Date.now(), 'leave')
  assert.equal(leaveNotices(takePresence()).length, 0)
  const reclaimed = await joinPartyRoom(third, { roomId: '334455', nickname: 'alice', characterId: '101' })
  assert.equal(reclaimed.ok, true)
  assert.deepEqual(reclaimed.messages.map(message => message.kind), ['leave'])
})

test('character changes update presence and recent message history', async (t) => {
  const peer = { id: 'character-editor', send() {}, close() {} }
  assert.equal(registerPartyConnection(peer, 'local-character-editor'), true)
  t.after(() => removePartyConnection(peer))
  assert.equal((await changePartyCharacter(peer, '306')).code, 'NOT_IN_ROOM')
  assert.equal((await createPartyRoom('112233')).ok, true)
  const joined = await joinPartyRoom(peer, { roomId: '112233', nickname: '파티원', characterId: '101' })
  assert.equal(joined.ok, true)
  assert.equal((await sendPartyChat(peer, { text: '안녕하세요' })).message.participant.characterId, '101')
  assert.equal((await changePartyCharacter(peer, 'invalid')).code, 'INVALID_CHARACTER')
  const changed = await changePartyCharacter(peer, '306')
  assert.equal(changed.ok, true)
  assert.equal(changed.participants[0].characterId, '306')
  assert.equal(changed.participants[0].nickname, '파티원')
  assert.equal((await sendPartyChat(peer, { text: '변경 후 메시지' })).message.participant.characterId, '306')

  const visitor = { id: 'history-reader', send() {}, close() {} }
  assert.equal(registerPartyConnection(visitor, 'local-history-reader'), true)
  t.after(() => removePartyConnection(visitor))
  const history = await joinPartyRoom(visitor, { roomId: '112233', nickname: '방문자', characterId: '101' })
  assert.equal(history.ok, true)
  assert.deepEqual(history.messages.map(message => message.participant.characterId), ['306', '306'])
})

test('spectators have no order and players may share an order', async (t) => {
  const spectator = { id: 'spectator', send() {}, close() {} }
  const player = { id: 'player', send() {}, close() {} }
  for (const peer of [spectator, player]) {
    assert.equal(registerPartyConnection(peer, `local-${peer.id}`), true)
    t.after(() => removePartyConnection(peer))
  }
  assert.equal((await createPartyRoom('223344')).ok, true)
  assert.equal((await joinPartyRoom(spectator, { roomId: '223344', nickname: '관전자', characterId: 'spectator', order: 'P1' })).code, 'SPECTATOR_ORDER_DISABLED')
  assert.equal((await joinPartyRoom(player, { roomId: '223344', nickname: '플레이어', characterId: '101', order: 'P5' })).code, 'INVALID_ORDER')

  const joinedSpectator = await joinPartyRoom(spectator, { roomId: '223344', nickname: '관전자', characterId: 'spectator', order: null })
  assert.equal(joinedSpectator.ok, true)
  assert.equal(joinedSpectator.participants[0].order, null)
  assert.equal((await changePartyOrder(spectator, 'P1')).code, 'SPECTATOR_ORDER_DISABLED')
  assert.equal((await sendPartyChat(spectator, { text: '관전 중' })).message.participant.order, null)

  const joinedPlayer = await joinPartyRoom(player, { roomId: '223344', nickname: '플레이어', characterId: '101', order: 'P2' })
  assert.equal(joinedPlayer.ok, true)
  assert.equal(joinedPlayer.participants.find(participant => participant.nickname === '플레이어').order, 'P2')
  assert.equal((await changePartyOrder(player, 'P5')).code, 'INVALID_ORDER')
  assert.equal((await changePartyOrder(player, 'P3')).participants.find(participant => participant.nickname === '플레이어').order, 'P3')
  assert.equal((await sendPartyChat(player, { text: '참가 중' })).message.participant.order, 'P3')

  const changed = await changePartyCharacter(spectator, '306')
  assert.equal(changed.ok, true)
  assert.equal(changed.participants.find(participant => participant.nickname === '관전자').order, 'P1')
  assert.equal((await changePartyOrder(spectator, 'P3')).participants.filter(participant => participant.order === 'P3').length, 2)
  assert.equal((await changePartyCharacter(spectator, 'spectator')).participants.find(participant => participant.nickname === '관전자').order, null)

  const reader = { id: 'order-reader', send() {}, close() {} }
  assert.equal(registerPartyConnection(reader, 'local-order-reader'), true)
  t.after(() => removePartyConnection(reader))
  const history = await joinPartyRoom(reader, { roomId: '223344', nickname: '독자', characterId: 'spectator' })
  assert.equal(history.ok, true)
  assert.deepEqual(history.messages.map(message => message.participant.order), [null, 'P3'])
})

test('unselected players have no image and keep all four orders', async (t) => {
  assert.equal(PARTY_CHARACTER_IDS.length, 35)
  assert.equal(PARTY_CHARACTER_IDS.includes(PARTY_UNSELECTED_ID), false)
  assert.equal(isPartyCharacterId(PARTY_UNSELECTED_ID), true)
  assert.equal(getPartyCharacterImage(PARTY_UNSELECTED_ID), '')
  assert.equal(getPartyCharacterImage('spectator'), '')
  assert.equal(getPartyCharacterImage('101'), 'https://file.maynutlab.com/character/UT_Item_Hero_101.png')
  for (const value of ['Unselected', ' unselected ', 'unknown', '', null, 101]) {
    assert.equal(isPartyCharacterId(value), false)
  }

  assert.equal((await createPartyRoom('223345')).ok, true)
  for (const order of PARTY_ORDERS) {
    const peer = { id: `unselected-${order}`, send() {}, close() {} }
    assert.equal(registerPartyConnection(peer, peer.id), true)
    t.after(() => removePartyConnection(peer))
    const input = { roomId: '223345', nickname: peer.id, characterId: PARTY_UNSELECTED_ID }
    for (const invalidOrder of ['P5', '', null, 1]) {
      assert.equal((await joinPartyRoom(peer, { ...input, order: invalidOrder })).code, 'INVALID_ORDER')
    }
    const joined = await joinPartyRoom(peer, { ...input, order })
    assert.equal(joined.ok, true)
    assert.equal(joined.participants.find(participant => participant.id === joined.participantId).order, order)
    assert.equal((await changePartyOrder(peer, 'P5')).code, 'INVALID_ORDER')
    for (const nextOrder of PARTY_ORDERS) {
      const changed = await changePartyOrder(peer, nextOrder)
      assert.equal(changed.ok, true)
      assert.equal(changed.participants.find(participant => participant.id === joined.participantId).order, nextOrder)
    }
    const chat = await sendPartyChat(peer, { text: '캐릭터 선택 전' })
    assert.equal(chat.ok, true)
    assert.equal(chat.message.participant.characterId, PARTY_UNSELECTED_ID)
    assert.equal(chat.message.participant.order, 'P4')
  }
})

test('unselected transitions preserve player orders and clear spectator orders in history', async (t) => {
  assert.equal((await createPartyRoom('223346')).ok, true)
  const peer = { id: 'unselected-transitions', send() {}, close() {} }
  const reader = { id: 'unselected-transitions-reader', send() {}, close() {} }
  for (const connection of [peer, reader]) {
    assert.equal(registerPartyConnection(connection, connection.id), true)
    t.after(() => removePartyConnection(connection))
  }
  const joined = await joinPartyRoom(peer, { roomId: '223346', nickname: '미선택 플레이어', characterId: PARTY_UNSELECTED_ID })
  assert.equal(joined.ok, true)
  assert.equal(joined.participants[0].order, 'P1')
  assert.equal((await changePartyOrder(peer, 'P3')).ok, true)
  const first = await sendPartyChat(peer, { text: '선택 전' })
  assert.equal(first.ok, true)

  for (const characterId of ['306', PARTY_UNSELECTED_ID]) {
    const changed = await changePartyCharacter(peer, characterId)
    assert.equal(changed.ok, true)
    assert.equal(changed.participants[0].characterId, characterId)
    assert.equal(changed.participants[0].order, 'P3')
  }
  assert.equal((await changePartyCharacter(peer, 'spectator')).participants[0].order, null)
  assert.equal((await changePartyOrder(peer, 'P4')).code, 'SPECTATOR_ORDER_DISABLED')
  const spectatorHistory = await joinPartyRoom(reader, { roomId: '223346', nickname: '독자', characterId: 'spectator' })
  assert.equal(spectatorHistory.ok, true)
  assert.equal(spectatorHistory.messages[0].participant.characterId, 'spectator')
  assert.equal(spectatorHistory.messages[0].participant.order, null)

  const waiting = await changePartyCharacter(peer, PARTY_UNSELECTED_ID)
  assert.equal(waiting.ok, true)
  assert.equal(waiting.participants.find(participant => participant.id === joined.participantId).order, 'P1')
  assert.equal((await changePartyOrder(peer, 'P4')).ok, true)
  const second = await sendPartyChat(peer, { text: '다시 미선택' })
  const earlier = await getPartyHistory(reader, second.message.id)
  assert.deepEqual(earlier.messages.map(message => [message.id, message.participant.characterId, message.participant.order]), [[first.message.id, PARTY_UNSELECTED_ID, 'P4']])

  await removePartyConnection(peer)
  const restarted = await import('../server/utils/party-chat.ts?unselected-restart-test')
  restarted.setPartyChatStore(memoryStore)
  const restoredPeer = { id: 'unselected-restored', send() {}, close() {} }
  assert.equal(restarted.registerPartyConnection(restoredPeer, restoredPeer.id), true)
  t.after(() => restarted.removePartyConnection(restoredPeer))
  const restored = await restarted.joinPartyRoom(restoredPeer, { roomId: '223346', nickname: '미선택 플레이어', characterId: PARTY_UNSELECTED_ID, order: 'P4', reconnectToken: joined.reconnectToken })
  assert.equal(restored.ok, true)
  assert.equal(restored.sessionId, joined.sessionId)
  assert.deepEqual(restored.messages.filter(message => message.kind === 'chat').map(message => [message.participant.characterId, message.participant.order]), [[PARTY_UNSELECTED_ID, 'P4'], [PARTY_UNSELECTED_ID, 'P4']])
})

test('a valid session and its transcript survive a process restart', async (t) => {
  const peer = { id: 'restart-writer', send() {}, close() {} }
  assert.equal((await createPartyRoom('998877')).ok, true)
  assert.equal(registerPartyConnection(peer, 'restart-writer'), true)
  const firstJoin = await joinPartyRoom(peer, { roomId: '998877', nickname: '작성자', characterId: '101' })
  assert.equal(firstJoin.ok, true)
  assert.equal((await sendPartyChat(peer, { text: '재시작 전 메시지' })).ok, true)
  await removePartyConnection(peer)

  const restarted = await import('../server/utils/party-chat.ts?restart-test')
  restarted.setPartyChatStore(memoryStore)
  const reader = { id: 'restart-reader', send() {}, close() {} }
  assert.equal(restarted.registerPartyConnection(reader, 'restart-reader'), true)
  t.after(() => restarted.removePartyConnection(reader))
  const restored = await restarted.joinPartyRoom(reader, { roomId: '998877', nickname: '독자', characterId: 'spectator' })
  assert.equal(restored.ok, true)
  assert.equal(restored.sessionId, firstJoin.sessionId)
  assert.ok(restored.messages.some(message => message.kind === 'chat' && message.text === '재시작 전 메시지'))
})

test('a failed database write does not add a chat message to the room', async (t) => {
  const writer = { id: 'failed-write-writer', send() {}, close() {} }
  const reader = { id: 'failed-write-reader', send() {}, close() {} }
  t.after(async () => {
    setPartyChatStore(memoryStore)
    await removePartyConnection(writer)
    await removePartyConnection(reader)
  })
  assert.equal((await createPartyRoom('998878')).ok, true)
  assert.equal(registerPartyConnection(writer, 'failed-write-writer'), true)
  assert.equal((await joinPartyRoom(writer, { roomId: '998878', nickname: '작성자', characterId: '101' })).ok, true)
  setPartyChatStore({
    ...memoryStore,
    async appendMessage(sessionId, message, leftParticipantId) {
      if (message.kind === 'chat' && message.text === '저장 실패') throw new Error('database unavailable')
      return memoryStore.appendMessage(sessionId, message, leftParticipantId)
    }
  })
  await assert.rejects(sendPartyChat(writer, { text: '저장 실패' }), /database unavailable/)
  setPartyChatStore(memoryStore)
  assert.equal(registerPartyConnection(reader, 'failed-write-reader'), true)
  const joined = await joinPartyRoom(reader, { roomId: '998878', nickname: '독자', characterId: '101' })
  assert.equal(joined.ok, true)
  assert.equal(joined.messages.some(message => message.kind === 'chat' && message.text === '저장 실패'), false)
})

test('reconnectToken takes over a half-open connection, preserves participantId, and suppresses duplicate notices', async (t) => {
  let firstClosed = false
  const first = {
    id: 'reconnect-first',
    send() {},
    close() {
      firstClosed = true
    }
  }
  const second = { id: 'reconnect-second', send() {}, close() {} }
  const third = { id: 'reconnect-third', send() {}, close() {} }
  const attacker = { id: 'reconnect-attacker', send() {}, close() {} }
  for (const peer of [first, second, third, attacker]) {
    assert.equal(registerPartyConnection(peer, 'reconnect-ip'), true)
    t.after(async () => {
      await removePartyConnection(peer, Date.now(), 'leave')
    })
  }

  assert.equal((await createPartyRoom('556677')).ok, true)
  const initial = await joinPartyRoom(first, { roomId: '556677', nickname: '별붕이', characterId: '101', order: 'P2' })
  assert.equal(initial.ok, true)
  assert.equal(typeof initial.reconnectToken, 'string')
  assert.ok(initial.reconnectToken.length > 0)
  const initialNotice = await recordPartyJoin(first)
  assert.equal(initialNotice?.notice.kind, 'join')
  takePresence()

  const firstChat = await sendPartyChat(first, { text: '끊기기 전 메시지', clientMessageId: 'msg-1' })
  assert.equal(firstChat.ok, true)

  // Without the token, a concurrent connection with the same nickname is rejected.
  const rejected = await joinPartyRoom(attacker, { roomId: '556677', nickname: '별붕이', characterId: '101', reconnectToken: 'wrong-token' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'NICKNAME_TAKEN')
  assert.equal(rejected.retryAfterMs, undefined)

  // With the valid reconnectToken, the new connection takes over while the first socket is still open.
  const resumed = await joinPartyRoom(second, {
    roomId: '556677',
    nickname: '별붕이',
    characterId: '101',
    order: 'P2',
    reconnectToken: initial.reconnectToken
  })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.resumed, true)
  assert.equal(resumed.participantId, initial.participantId)
  assert.equal(resumed.reconnectToken, initial.reconnectToken)
  assert.equal(resumed.participants.length, 1)
  assert.equal(firstClosed, true)
  assert.equal(await recordPartyJoin(second), null)
  // The replaced socket is already detached, so its close is a no-op and must not emit a notice.
  await removePartyConnection(first, Date.now(), 'loss')
  assert.equal(leaveNotices(takePresence()).length, 0)
  assert.equal(getPartyRoom('556677')?.participantCount, 1)

  // Updating character on the resumed connection also updates messages sent before reconnecting.
  const changed = await changePartyCharacter(second, '306')
  assert.equal(changed.ok, true)
  takePresence()

  // A socket loss during the grace window keeps the identity resumable.
  const resumedToken = resumed.reconnectToken
  await removePartyConnection(second, Date.now(), 'loss')
  assert.equal(leaveNotices(takePresence()).length, 0)
  assert.equal(canResumePartyParticipant('556677', '별붕이', resumedToken), true)

  const rejoinedAfterClose = await joinPartyRoom(third, {
    roomId: '556677',
    nickname: '별붕이',
    characterId: '306',
    order: 'P2',
    reconnectToken: resumedToken
  })
  assert.equal(rejoinedAfterClose.ok, true)
  assert.equal(rejoinedAfterClose.resumed, true)
  assert.equal(rejoinedAfterClose.participantId, initial.participantId)
  assert.equal(rejoinedAfterClose.reconnectToken, resumedToken)
  assert.equal(await recordPartyJoin(third), null)
  const chatMessages = rejoinedAfterClose.messages.filter(message => message.kind === 'chat')
  assert.equal(chatMessages.length, 1)
  assert.equal(chatMessages[0].participant.id, initial.participantId)
  assert.equal(chatMessages[0].participant.characterId, '306')
})

test('concurrent JOIN requests on the same socket cannot leave ghost participants in multiple rooms', async (t) => {
  const peer = { id: 'concurrent-join-peer', send() {}, close() {} }
  assert.equal(registerPartyConnection(peer, 'concurrent-join-ip'), true)
  t.after(() => removePartyConnection(peer))

  assert.equal((await createPartyRoom('667788')).ok, true)
  assert.equal((await createPartyRoom('667789')).ok, true)

  const results = await Promise.all([
    joinPartyRoom(peer, { roomId: '667788', nickname: '동시입장', characterId: '101' }),
    joinPartyRoom(peer, { roomId: '667789', nickname: '동시입장', characterId: '101' })
  ])
  const successes = results.filter(result => result.ok)
  const failures = results.filter(result => !result.ok)
  assert.equal(successes.length, 1)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].code, 'ALREADY_JOINED')

  await removePartyConnection(peer)
  assert.equal(getPartyRoom('667788')?.participantCount, 0)
  assert.equal(getPartyRoom('667789')?.participantCount, 0)
})

test('concurrent character and order updates are serialized and preserve spectator constraints', async (t) => {
  const peer = { id: 'concurrent-state-peer', send() {}, close() {} }
  assert.equal(registerPartyConnection(peer, 'concurrent-state-ip'), true)
  t.after(async () => {
    setPartyChatStore(memoryStore)
    await removePartyConnection(peer)
  })

  assert.equal((await createPartyRoom('667790')).ok, true)
  const joined = await joinPartyRoom(peer, { roomId: '667790', nickname: '상태변경', characterId: '101', order: 'P1' })
  assert.equal(joined.ok, true)

  let releaseUpdate
  const gate = new Promise((resolve) => {
    releaseUpdate = resolve
  })
  let firstUpdate = true
  setPartyChatStore({
    ...memoryStore,
    async updateParticipant(participant) {
      if (firstUpdate) {
        firstUpdate = false
        await gate
      }
      await memoryStore.updateParticipant(participant)
    }
  })

  const charPromise = changePartyCharacter(peer, 'spectator')
  const orderPromise = changePartyOrder(peer, 'P2')
  releaseUpdate()
  const [charResult, orderResult] = await Promise.all([charPromise, orderPromise])
  assert.equal(charResult.ok, true)
  assert.equal(orderResult.ok, false)
  assert.equal(orderResult.code, 'SPECTATOR_ORDER_DISABLED')
  assert.equal(storedParticipants.get(joined.participantId).characterId, 'spectator')
  assert.equal(storedParticipants.get(joined.participantId).order, null)
})

test('disconnecting while recordPartyJoin is persisting does not throw and deduplicates clientMessageId', async (t) => {
  const peer = { id: 'join-persist-peer', send() {}, close() {} }
  assert.equal(registerPartyConnection(peer, 'join-persist-ip'), true)
  t.after(async () => {
    setPartyChatStore(memoryStore)
    await removePartyConnection(peer, Date.now(), 'leave')
  })

  assert.equal((await createPartyRoom('667791')).ok, true)
  const joined = await joinPartyRoom(peer, { roomId: '667791', nickname: '공지경합', characterId: '101' })
  assert.equal(joined.ok, true)

  // Duplicate clientMessageId from the same participant is idempotent.
  const firstSend = await sendPartyChat(peer, { text: '중복 방지 메시지', clientMessageId: 'dedupe-id-1' })
  const secondSend = await sendPartyChat(peer, { text: '중복 방지 메시지', clientMessageId: 'dedupe-id-1' })
  assert.equal(firstSend.ok, true)
  assert.equal(secondSend.ok, true)
  assert.equal(firstSend.message.id, secondSend.message.id)
  assert.equal(storedSessions.get(joined.sessionId).messages.filter(m => m.kind === 'chat').length, 1)
  takePresence()

  let releaseJoinNotice
  const noticeGate = new Promise((resolve) => {
    releaseJoinNotice = resolve
  })
  let blockJoinNotice = true
  setPartyChatStore({
    ...memoryStore,
    async appendMessage(sessionId, message, leftParticipantId) {
      if (blockJoinNotice && message.kind === 'join') {
        blockJoinNotice = false
        await noticeGate
      }
      return memoryStore.appendMessage(sessionId, message, leftParticipantId)
    }
  })

  const joinNoticePromise = recordPartyJoin(peer)
  const leavePromise = removePartyConnection(peer, Date.now(), 'leave')
  releaseJoinNotice()
  const [joinNoticeResult] = await Promise.all([joinNoticePromise, leavePromise])
  assert.equal(joinNoticeResult?.notice.kind, 'join')
  const notices = leaveNotices(takePresence())
  assert.equal(notices.length, 1)
  assert.equal(notices[0].kind, 'leave')
  assert.equal(notices[0].nickname, '공지경합')
  const stored = storedSessions.get(joined.sessionId).messages.map(message => message.kind)
  assert.deepEqual(stored.slice(-2), ['join', 'leave'])
})

test('intentional leave publishes presence before the blocked leave write resolves, and only one notice', async (t) => {
  const peer = { id: 'leave-blocked-peer', send() {}, close() {} }
  assert.equal(registerPartyConnection(peer, 'leave-blocked-ip'), true)
  t.after(async () => {
    setPartyChatStore(memoryStore)
    await removePartyConnection(peer, Date.now(), 'leave')
  })

  assert.equal((await createPartyRoom('667792')).ok, true)
  const joined = await joinPartyRoom(peer, { roomId: '667792', nickname: '차단퇴장', characterId: '101' })
  assert.equal(joined.ok, true)
  await recordPartyJoin(peer)
  takePresence()

  let releaseLeave
  const leaveGate = new Promise((resolve) => {
    releaseLeave = resolve
  })
  let blockLeave = true
  setPartyChatStore({
    ...memoryStore,
    async appendMessage(sessionId, message, leftParticipantId) {
      if (blockLeave && message.kind === 'leave') {
        blockLeave = false
        await leaveGate
      }
      return memoryStore.appendMessage(sessionId, message, leftParticipantId)
    }
  })

  const removal = removePartyConnection(peer, Date.now(), 'leave')
  await new Promise(resolve => setImmediate(resolve))

  // 참가자 수 변화는 저장이 막혀 있어도 즉시 관찰된다.
  assert.equal(getPartyRoom('667792')?.participantCount, 0)
  const immediate = takePresence()
  assert.equal(immediate.length, 1)
  assert.deepEqual(immediate[0].participants, [])
  assert.equal(immediate[0].notice, undefined)
  assert.equal(storedSessions.get(joined.sessionId).messages.some(message => message.kind === 'leave'), false)

  releaseLeave()
  await removal
  const afterWrite = leaveNotices(takePresence())
  assert.equal(afterWrite.length, 1)
  assert.equal(afterWrite[0].kind, 'leave')
})

test('a failed leave write publishes no leave notice and keeps the nickname reservation released', async (t) => {
  const peer = { id: 'leave-fail-peer', send() {}, close() {} }
  assert.equal(registerPartyConnection(peer, 'leave-fail-ip'), true)
  t.after(async () => {
    setPartyChatStore(memoryStore)
    await removePartyConnection(peer, Date.now(), 'leave')
  })

  assert.equal((await createPartyRoom('667793')).ok, true)
  assert.equal((await joinPartyRoom(peer, { roomId: '667793', nickname: '저장실패퇴장', characterId: '101' })).ok, true)
  takePresence()

  setPartyChatStore({
    ...memoryStore,
    async appendMessage(sessionId, message, leftParticipantId) {
      if (message.kind === 'leave') throw new Error('leave write failed')
      return memoryStore.appendMessage(sessionId, message, leftParticipantId)
    }
  })

  await removePartyConnection(peer, Date.now(), 'leave')
  setPartyChatStore(memoryStore)
  assert.equal(leaveNotices(takePresence()).length, 0)
  assert.equal(isPartyNicknameTaken('667793', '저장실패퇴장'), false)
})

test('socket loss reserves the nickname for the grace window and expiry publishes exactly one leave', async (t) => {
  const startedAt = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: startedAt })
  const peer = { id: 'grace-peer', send() {}, close() {} }
  const rival = { id: 'grace-rival', send() {}, close() {} }
  for (const connection of [peer, rival]) {
    assert.equal(registerPartyConnection(connection, connection.id), true)
    t.after(async () => {
      setPartyChatStore(memoryStore)
      await removePartyConnection(connection, Date.now(), 'leave')
    })
  }

  assert.equal((await createPartyRoom('667794')).ok, true)
  const joined = await joinPartyRoom(peer, { roomId: '667794', nickname: 'Grace', characterId: '101' })
  assert.equal(joined.ok, true)
  takePresence()

  await removePartyConnection(peer, startedAt, 'loss')
  const lossUpdates = takePresence()
  // 손실은 즉시 참가자 목록만 갱신하고 퇴장 공지를 만들지 않는다.
  assert.equal(lossUpdates.length, 1)
  assert.equal(lossUpdates[0].notice, undefined)
  assert.equal(getPartyRoom('667794')?.participantCount, 0)
  assert.equal(isPartyNicknameTaken('667794', 'grace'), true)

  // 다른 참가자는 유예가 끝날 때까지 같은 닉네임을 쓸 수 없다.
  const blocked = await joinPartyRoom(rival, { roomId: '667794', nickname: 'ＧＲＡＣＥ', characterId: '101' })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'NICKNAME_TAKEN')
  assert.equal(blocked.retryAfterMs, PARTY_LIMITS.connectionLossGraceMs)

  // 유효 토큰 소유자는 예약을 무시하고 재개한다.
  assert.equal(canResumePartyParticipant('667794', 'grace', joined.reconnectToken), true)
  assert.equal(canResumePartyParticipant('667794', 'other', joined.reconnectToken), false)
  assert.equal(canResumePartyParticipant('667794', 'grace', 'invalid-token'), false)

  const resumed = await joinPartyRoom(rival, {
    roomId: '667794',
    nickname: 'grace',
    characterId: '101',
    reconnectToken: joined.reconnectToken
  })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.participantId, joined.participantId)
  assert.equal(resumed.reconnectToken, joined.reconnectToken)
  assert.equal(resumed.resumed, true)
  assert.equal(getPartyRoom('667794')?.participantCount, 1)
  assert.equal(leaveNotices(takePresence()).length, 0)

  // 재개 뒤 다시 손실되면 새 유예가 시작되고, 중복 close는 아무 것도 만들지 않는다.
  await removePartyConnection(rival, Date.now(), 'loss')
  takePresence()
  await removePartyConnection(rival, Date.now(), 'loss')
  assert.equal(takePresence().length, 0)

  const expiresAt = Date.now() + PARTY_LIMITS.connectionLossGraceMs
  t.mock.timers.setTime(expiresAt - 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(isPartyNicknameTaken('667794', 'grace'), true)
  assert.equal(leaveNotices(takePresence()).length, 0)

  t.mock.timers.tick(1)
  await new Promise(resolve => setImmediate(resolve))
  const expiryNotices = leaveNotices(takePresence())
  assert.equal(expiryNotices.length, 1)
  assert.equal(expiryNotices[0].kind, 'leave')
  assert.equal(expiryNotices[0].nickname, 'grace')
  assert.equal(isPartyNicknameTaken('667794', 'grace'), false)
  assert.equal(canResumePartyParticipant('667794', 'grace', joined.reconnectToken), false)

  // 만료 이후 늦게 남은 타이머는 아무 것도 만들지 않는다.
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(PARTY_LIMITS.connectionLossGraceMs)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(leaveNotices(takePresence()).length, 0)
  assert.equal(storedSessions.get(joined.sessionId).messages.filter(message => message.kind === 'leave').length, 1)
})

test('a stale grace timer cannot expire a resumed identity, and a duplicated close is a no-op', async (t) => {
  const first = { id: 'stale-first', send() {}, close() {} }
  const second = { id: 'stale-second', send() {}, close() {} }
  for (const connection of [first, second]) {
    assert.equal(registerPartyConnection(connection, connection.id), true)
    t.after(async () => {
      setPartyChatStore(memoryStore)
      await removePartyConnection(connection, Date.now(), 'leave')
    })
  }

  assert.equal((await createPartyRoom('667795')).ok, true)
  const joined = await joinPartyRoom(first, { roomId: '667795', nickname: 'Stale', characterId: '101' })
  assert.equal(joined.ok, true)
  takePresence()

  const startedAt = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: startedAt })
  await removePartyConnection(first, startedAt, 'loss')
  takePresence()

  // 유예 중 재개하면 이전 타이머를 취소한다.
  t.mock.timers.setTime(startedAt + PARTY_LIMITS.connectionLossGraceMs - 1)
  const resumed = await joinPartyRoom(second, {
    roomId: '667795',
    nickname: 'Stale',
    characterId: '101',
    reconnectToken: joined.reconnectToken
  })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.resumed, true)

  t.mock.timers.tick(PARTY_LIMITS.connectionLossGraceMs * 2)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(leaveNotices(takePresence()).length, 0)
  assert.equal(getPartyRoom('667795')?.participantCount, 1)

  // 두 번 호출된 close는 두 번째부터 아무 것도 하지 않는다.
  await removePartyConnection(second, Date.now(), 'leave')
  const notices = leaveNotices(takePresence())
  assert.equal(notices.length, 1)
  await removePartyConnection(second, Date.now(), 'leave')
  assert.equal(leaveNotices(takePresence()).length, 0)
  assert.equal(storedSessions.get(joined.sessionId).messages.filter(message => message.kind === 'leave').length, 1)
})

test('live takeover releases the old connection IP quota immediately', async (t) => {
  t.after(() => setPartyChatStore(memoryStore))
  assert.equal((await createPartyRoom('667796')).ok, true)
  const ip = 'takeover-quota-ip'
  const original = { id: 'takeover-quota-original', send() {}, close() {} }
  const replacement = { id: 'takeover-quota-replacement', send() {}, close() {} }
  const blocked = { id: 'takeover-quota-blocked', send() {}, close() {} }
  const next = { id: 'takeover-quota-next', send() {}, close() {} }

  // 같은 IP의 동시 연결 한도를 정확히 채운 뒤 인계가 즉시 자리를 비우는지 본다.
  const fillers = Array.from({ length: PARTY_LIMITS.maxConnectionsPerIp - 2 }, (_, index) => ({
    id: `takeover-quota-filler-${index}`,
    send() {},
    close() {}
  }))
  for (const peer of [original, replacement, ...fillers]) {
    assert.equal(registerPartyConnection(peer, ip), true)
    t.after(async () => removePartyConnection(peer, Date.now(), 'leave'))
  }
  t.after(() => removePartyConnection(blocked, Date.now(), 'leave'))
  t.after(() => removePartyConnection(next, Date.now(), 'leave'))
  assert.equal(registerPartyConnection(blocked, ip), false)

  const joined = await joinPartyRoom(original, { roomId: '667796', nickname: 'Quota', characterId: '101' })
  assert.equal(joined.ok, true)

  const resumed = await joinPartyRoom(replacement, {
    roomId: '667796',
    nickname: 'Quota',
    characterId: '101',
    reconnectToken: joined.reconnectToken
  })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.participantId, joined.participantId)
  // 인계로 비워진 자리 덕분에 추가 연결을 받을 수 있다.
  assert.equal(registerPartyConnection(next, ip), true)
})

test('rate exemption requires a normalized nickname owned by a live or pending token', async (t) => {
  t.after(() => setPartyChatStore(memoryStore))
  assert.equal((await createPartyRoom('667797')).ok, true)
  const owner = { id: 'rate-owner', send() {}, close() {} }
  const other = { id: 'rate-other', send() {}, close() {} }
  const limiterIp = 'rate-exempt-ip'
  for (const connection of [owner, other]) {
    assert.equal(registerPartyConnection(connection, limiterIp), true)
    t.after(async () => removePartyConnection(connection, Date.now(), 'leave'))
  }

  const joined = await joinPartyRoom(owner, { roomId: '667797', nickname: 'Rate', characterId: '101' })
  assert.equal(joined.ok, true)
  const token = joined.reconnectToken

  // 예산을 모두 소진한 뒤의 제한은 남은 고정 창 시간을 알려준다.
  let exhausted = 0
  while (true) {
    const guess = await joinPartyRoom(other, { roomId: '654320', nickname: '탐색', characterId: '101' })
    if (guess.code !== 'ROOM_NOT_FOUND') {
      assert.equal(guess.code, 'JOIN_RATE_LIMITED')
      assert.ok(guess.retryAfterMs > 0 && guess.retryAfterMs <= PARTY_LIMITS.joinAttemptWindowMs)
      break
    }
    exhausted++
    assert.ok(exhausted <= PARTY_LIMITS.maxJoinAttemptsPerIp + 2)
  }

  // 정규화된 닉네임이 아니면 토큰만으로는 예외가 적용되지 않는다.
  const wrongNickname = await joinPartyRoom(other, { roomId: '667797', nickname: '다른이름', characterId: '101', reconnectToken: token })
  assert.equal(wrongNickname.code, 'JOIN_RATE_LIMITED')
  assert.ok(wrongNickname.retryAfterMs > 0)

  // 토큰이 유효하지 않아도 예외는 적용되지 않는다.
  const wrongToken = await joinPartyRoom(other, { roomId: '667797', nickname: 'Rate', characterId: '101', reconnectToken: 'not-a-token' })
  assert.equal(wrongToken.code, 'JOIN_RATE_LIMITED')
  assert.ok(wrongToken.retryAfterMs > 0)

  // 실제 소유자는 제한 창이 지나지 않았어도 재개할 수 있다.
  const resumed = await joinPartyRoom(other, { roomId: '667797', nickname: 'rate', characterId: '101', reconnectToken: token })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.resumed, true)
})

test('the join attempt fixed window resets on schedule and a lost exemption consumes exactly one attempt', async (t) => {
  t.after(() => setPartyChatStore(memoryStore))
  const startedAt = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: startedAt })
  const peer = { id: 'window-peer', send() {}, close() {} }
  assert.equal(registerPartyConnection(peer, 'window-ip'), true)
  t.after(async () => {
    await removePartyConnection(peer, Date.now(), 'leave')
  })

  const input = { roomId: '654321', nickname: '창', characterId: '101' }
  for (let index = 0; index < PARTY_LIMITS.maxJoinAttemptsPerIp; index++) {
    assert.equal((await joinPartyRoom(peer, input)).code, 'ROOM_NOT_FOUND')
  }
  const limited = await joinPartyRoom(peer, input)
  assert.equal(limited.code, 'JOIN_RATE_LIMITED')
  assert.equal(limited.retryAfterMs, PARTY_LIMITS.joinAttemptWindowMs)

  t.mock.timers.setTime(startedAt + PARTY_LIMITS.joinAttemptWindowMs - 1)
  const stillLimited = await joinPartyRoom(peer, input)
  assert.equal(stillLimited.code, 'JOIN_RATE_LIMITED')
  assert.equal(stillLimited.retryAfterMs, 1)

  // 고정 창이 끝나면 새 예산이 시작된다.
  t.mock.timers.setTime(startedAt + PARTY_LIMITS.joinAttemptWindowMs)
  assert.equal((await joinPartyRoom(peer, input)).code, 'ROOM_NOT_FOUND')
})

test('queued CHAT keeps the accepted sender after the connection closes, and an earlier profile change lands first', async (t) => {
  const peer = { id: 'chat-queue-peer', send() {}, close() {} }
  assert.equal(registerPartyConnection(peer, 'chat-queue-ip'), true)
  t.after(async () => {
    setPartyChatStore(memoryStore)
    await removePartyConnection(peer, Date.now(), 'leave')
  })

  assert.equal((await createPartyRoom('667798')).ok, true)
  const joined = await joinPartyRoom(peer, { roomId: '667798', nickname: '큐발신자', characterId: '101' })
  assert.equal(joined.ok, true)
  await recordPartyJoin(peer)
  takePresence()

  let releaseProfile
  const profileGate = new Promise((resolve) => {
    releaseProfile = resolve
  })
  let blockProfile = true
  setPartyChatStore({
    ...memoryStore,
    async updateParticipant(participant) {
      if (blockProfile) {
        blockProfile = false
        await profileGate
      }
      await memoryStore.updateParticipant(participant)
    }
  })

  const profilePromise = changePartyCharacter(peer, '306')
  const chatPromise = sendPartyChat(peer, { text: '큐 대기 메시지', clientMessageId: 'queued-1' })
  const closing = removePartyConnection(peer, Date.now(), 'leave')
  releaseProfile()

  const [profileResult, chatResult] = await Promise.all([profilePromise, chatPromise])
  await closing
  setPartyChatStore(memoryStore)

  assert.equal(profileResult.ok, true)
  assert.equal(chatResult.ok, true)
  // 발신자 정보는 빈 닉네임/관전자 기본값으로 대체되지 않는다.
  assert.equal(chatResult.message.participant.id, joined.participantId)
  assert.equal(chatResult.message.participant.nickname, '큐발신자')
  assert.equal(chatResult.message.participant.characterId, '306')
  assert.equal(chatResult.message.text, '큐 대기 메시지')

  const stored = storedSessions.get(joined.sessionId).messages
  const storedChat = stored.find(message => message.kind === 'chat' && message.clientMessageId === 'queued-1')
  assert.equal(storedChat.participant.id, joined.participantId)
  assert.equal(storedChat.participant.nickname, '큐발신자')
  assert.equal(storedChat.participant.characterId, '306')
  // 저장 순서: 입장 공지 → 프로필 변경 반영된 채팅 → 퇴장
  assert.deepEqual(stored.map(message => message.kind), ['join', 'chat', 'leave'])
  assert.equal(storedParticipants.get(joined.participantId).characterId, '306')
})

test('a profile change queued before disconnect does not resurrect live presence or the token', async (t) => {
  const peer = { id: 'profile-detach-peer', send() {}, close() {} }
  assert.equal(registerPartyConnection(peer, 'profile-detach-ip'), true)
  t.after(async () => {
    setPartyChatStore(memoryStore)
    await removePartyConnection(peer, Date.now(), 'leave')
  })

  assert.equal((await createPartyRoom('667799')).ok, true)
  const joined = await joinPartyRoom(peer, { roomId: '667799', nickname: '분리프로필', characterId: '101' })
  assert.equal(joined.ok, true)
  takePresence()

  let releaseProfile
  const gate = new Promise((resolve) => {
    releaseProfile = resolve
  })
  let block = true
  setPartyChatStore({
    ...memoryStore,
    async updateParticipant(participant) {
      if (block) {
        block = false
        await gate
      }
      await memoryStore.updateParticipant(participant)
    }
  })

  const profilePromise = changePartyCharacter(peer, '306')
  await new Promise(resolve => setImmediate(resolve))
  // 퇴장 저장은 프로필 변경 뒤에 큐에서 기다리므로 완료를 기다리지 않고 먼저 확인한다.
  const removal = removePartyConnection(peer, Date.now(), 'leave')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(getPartyRoom('667799')?.participantCount, 0)
  takePresence()
  releaseProfile()
  const result = await profilePromise
  await removal
  setPartyChatStore(memoryStore)

  assert.equal(result.ok, true)
  // DB 갱신은 반영되지만 실시간 참가자/토큰은 되살아나지 않는다.
  assert.equal(storedParticipants.get(joined.participantId).characterId, '306')
  assert.equal(getPartyRoom('667799')?.participantCount, 0)
  assert.equal(canResumePartyParticipant('667799', '분리프로필', joined.reconnectToken), false)
})

test('a stale grace deadline cannot expire a resumed identity early', async (t) => {
  t.after(() => setPartyChatStore(memoryStore))
  const startedAt = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: startedAt })
  const first = { id: 'stale-queued-first', send() {}, close() {} }
  const second = { id: 'stale-queued-second', send() {}, close() {} }
  for (const connection of [first, second]) {
    assert.equal(registerPartyConnection(connection, connection.id), true)
    t.after(async () => {
      setPartyChatStore(memoryStore)
      await removePartyConnection(connection, Date.now(), 'leave')
    })
  }

  assert.equal((await createPartyRoom('667800')).ok, true)
  const joined = await joinPartyRoom(first, { roomId: '667800', nickname: '세대', characterId: '101' })
  assert.equal(joined.ok, true)
  takePresence()

  // 첫 손실: 세대 1의 만료 시각은 startedAt + grace.
  await removePartyConnection(first, startedAt, 'loss')
  takePresence()

  // 만료 직전에 재개하면 이전 세대 타이머/마감이 취소된다.
  t.mock.timers.setTime(startedAt + PARTY_LIMITS.connectionLossGraceMs - 1)
  const resumed = await joinPartyRoom(second, {
    roomId: '667800',
    nickname: '세대',
    characterId: '101',
    reconnectToken: joined.reconnectToken
  })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.participantId, joined.participantId)
  assert.equal(resumed.reconnectToken, joined.reconnectToken)

  // 재개 시점에 다시 손실되면 새 세대의 유예는 그 시점부터 시작한다.
  const lossAt = Date.now()
  await removePartyConnection(second, lossAt, 'loss')
  takePresence()

  // 이전 세대의 마감을 지나도 새 세대는 만료되지 않는다(이전 타이머/콜백은 세대 검사로 무시).
  t.mock.timers.setTime(startedAt + PARTY_LIMITS.connectionLossGraceMs)
  t.mock.timers.tick(1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(leaveNotices(takePresence()).length, 0)
  assert.equal(isPartyNicknameTaken('667800', '세대'), true)
  assert.equal(canResumePartyParticipant('667800', '세대', resumed.reconnectToken), true)

  // 새 세대의 마감에만 정확히 한 건의 퇴장이 확정된다.
  t.mock.timers.setTime(lossAt + PARTY_LIMITS.connectionLossGraceMs)
  t.mock.timers.tick(1)
  await new Promise(resolve => setImmediate(resolve))
  const notices = leaveNotices(takePresence())
  assert.equal(notices.length, 1)
  assert.equal(notices[0].nickname, '세대')
  assert.equal(isPartyNicknameTaken('667800', '세대'), false)
  assert.equal(leaveNotices(takePresence()).length, 0)
  assert.equal(storedSessions.get(joined.sessionId).messages.filter(message => message.kind === 'leave').length, 1)
})

test('a profile change accepted during the takeover await is rejected instead of desyncing the new participant', async (t) => {
  t.after(() => setPartyChatStore(memoryStore))
  const first = { id: 'takeover-profile-first', send() {}, close() {} }
  const second = { id: 'takeover-profile-second', send() {}, close() {} }
  for (const connection of [first, second]) {
    assert.equal(registerPartyConnection(connection, connection.id), true)
    t.after(async () => {
      setPartyChatStore(memoryStore)
      await removePartyConnection(connection, Date.now(), 'leave')
    })
  }

  assert.equal((await createPartyRoom('667801')).ok, true)
  const joined = await joinPartyRoom(first, { roomId: '667801', nickname: '인계프로필', characterId: '101', order: 'P1' })
  assert.equal(joined.ok, true)
  takePresence()

  // 인계의 참가자 저장을 막고, 그 사이 이전 연결의 프로필 변경이 큐에 들어가게 한다.
  let releaseAdmission
  const admissionGate = new Promise((resolve) => {
    releaseAdmission = resolve
  })
  let blockAdmission = true
  setPartyChatStore({
    ...memoryStore,
    async upsertParticipant(sessionId, participant, reconnectTokenHash) {
      if (blockAdmission) {
        blockAdmission = false
        await admissionGate
      }
      await memoryStore.upsertParticipant(sessionId, participant, reconnectTokenHash)
    }
  })

  const takeoverPromise = joinPartyRoom(second, {
    roomId: '667801',
    nickname: '인계프로필',
    characterId: '101',
    order: 'P1',
    reconnectToken: joined.reconnectToken
  })
  await new Promise(resolve => setImmediate(resolve))

  // 인계 await 중 이전 연결이 수락한 프로필 작업: 인계 뒤에 실행되므로 적용되면 안 된다.
  const staleCharacter = changePartyCharacter(first, '306')
  const staleOrder = changePartyOrder(first, 'P4')
  await new Promise(resolve => setImmediate(resolve))
  releaseAdmission()

  const takeover = await takeoverPromise
  const [characterResult, orderResult] = await Promise.all([staleCharacter, staleOrder])
  setPartyChatStore(memoryStore)

  assert.equal(takeover.ok, true)
  assert.equal(takeover.participantId, joined.participantId)
  // 인계 뒤 도착한 낡은 작업은 거부되어 실시간 값, DB, 기록이 모두 일치한다.
  assert.equal(characterResult.ok, false)
  assert.equal(characterResult.code, 'NOT_IN_ROOM')
  assert.equal(orderResult.ok, false)
  assert.equal(orderResult.code, 'NOT_IN_ROOM')
  assert.equal(storedParticipants.get(joined.participantId).characterId, '101')
  assert.equal(storedParticipants.get(joined.participantId).order, 'P1')
  assert.equal(getPartyRoom('667801')?.participantCount, 1)
  const liveChat = await sendPartyChat(second, { text: '인계 후 메시지' })
  assert.equal(liveChat.ok, true)
  assert.equal(liveChat.message.participant.characterId, '101')
  assert.equal(liveChat.message.participant.id, joined.participantId)

  // 현재 연결의 프로필 변경은 정상 반영되어 DB/기록과 계속 일치한다.
  const current = await changePartyCharacter(second, '306')
  assert.equal(current.ok, true)
  assert.equal(storedParticipants.get(joined.participantId).characterId, '306')
  const afterChange = await sendPartyChat(second, { text: '변경 후' })
  assert.equal(afterChange.message.participant.characterId, '306')
})

test('a queued admission whose pending reservation expires consumes one budget and rejects when exhausted', async (t) => {
  t.after(() => setPartyChatStore(memoryStore))
  const ip = 'lost-exemption-ip'
  const startedAt = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: startedAt })
  const owner = { id: 'lost-exemption-owner', send() {}, close() {} }
  const contender = { id: 'lost-exemption-contender', send() {}, close() {} }
  const stayer = { id: 'lost-exemption-stayer', send() {}, close() {} }
  for (const connection of [owner, contender, stayer]) {
    assert.equal(registerPartyConnection(connection, ip), true)
    t.after(async () => {
      setPartyChatStore(memoryStore)
      await removePartyConnection(connection, Date.now(), 'leave')
    })
  }

  assert.equal((await createPartyRoom('667802')).ok, true)
  const joined = await joinPartyRoom(owner, { roomId: '667802', nickname: '만료예외', characterId: '101' })
  assert.equal(joined.ok, true)
  // 큐를 막을 상주 참가자는 예산 소진 전에 입장해 둔다.
  assert.equal((await joinPartyRoom(stayer, { roomId: '667802', nickname: '상주', characterId: '101' })).ok, true)
  takePresence()

  // 소유자를 손실시켜 유예 예약을 만든다. 이 시점 입장은 토큰 예외 대상이다.
  await removePartyConnection(owner, startedAt, { code: 4001, reason: 'page-hide' })
  takePresence()
  assert.equal(canResumePartyParticipant('667802', '만료예외', joined.reconnectToken), true)

  // 예산을 완전히 소진해, 예외가 사라진 뒤의 소비가 곧 거부가 되게 만든다.
  while (true) {
    const attempt = await joinPartyRoom(contender, { roomId: '654319', nickname: '소진', characterId: '101' })
    if (attempt.code !== 'ROOM_NOT_FOUND') {
      assert.equal(attempt.code, 'JOIN_RATE_LIMITED')
      break
    }
  }

  // 상주 참가자의 채팅 저장을 막아 이후 작업이 큐에서 대기하도록 한다.
  let releaseWrite
  const writeGate = new Promise((resolve) => {
    releaseWrite = resolve
  })
  let blockWrite = true
  setPartyChatStore({
    ...memoryStore,
    async appendMessage(sessionId, message, leftParticipantId) {
      if (blockWrite && message.kind === 'chat') {
        blockWrite = false
        await writeGate
      }
      return memoryStore.appendMessage(sessionId, message, leftParticipantId)
    }
  })

  const blockingChat = sendPartyChat(stayer, { text: '큐 차단', clientMessageId: 'lost-exemption-block' })
  await new Promise(resolve => setImmediate(resolve))
  // 사전 예외 판정은 아직 통과하지만 큐에서 대기한다.
  const admission = joinPartyRoom(contender, {
    roomId: '667802',
    nickname: '만료예외',
    characterId: '101',
    reconnectToken: joined.reconnectToken
  })
  await new Promise(resolve => setImmediate(resolve))

  // 큐 대기 중 유예가 만료되게 한 뒤 검사를 진행시킨다.
  t.mock.timers.setTime(startedAt + PARTY_LIMITS.pageHideGraceMs)
  releaseWrite()
  const [, admissionResult] = await Promise.all([blockingChat, admission])
  setPartyChatStore(memoryStore)

  assert.equal(admissionResult.ok, false)
  assert.equal(admissionResult.code, 'JOIN_RATE_LIMITED')
  assert.ok(admissionResult.retryAfterMs > 0
    && admissionResult.retryAfterMs <= PARTY_LIMITS.joinAttemptWindowMs)

  // 예산은 한 번만 소모되었고, 예약 만료로 닉네임과 토큰은 풀렸다.
  assert.equal(isPartyNicknameTaken('667802', '만료예외'), false)
  assert.equal(canResumePartyParticipant('667802', '만료예외', joined.reconnectToken), false)
  const stillDenied = await joinPartyRoom(contender, {
    roomId: '667802',
    nickname: '만료예외',
    characterId: '101',
    reconnectToken: joined.reconnectToken
  })
  assert.equal(stillDenied.code, 'JOIN_RATE_LIMITED')
  // 예약 만료는 정확히 한 건의 퇴장 공지를 남긴다.
  t.mock.timers.tick(1)
  await new Promise(resolve => setImmediate(resolve))
  const expiryNotices = leaveNotices(takePresence())
  assert.equal(expiryNotices.length, 1)
  assert.equal(expiryNotices[0].nickname, '만료예외')
})

test('page-hide and browser 1001 use fifteen seconds and resume cancels departure', async (t) => {
  const now = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  assert.equal(PARTY_LIMITS.pageHideGraceMs, 15_000)
  assert.equal(PARTY_LIMITS.connectionLossGraceMs, 60_000)
  const roomId = '901001'
  await createPartyRoom(roomId)
  const first = { id: 'page-first', send() {}, close() {} }
  const next = { id: 'page-next', send() {}, close() {} }
  registerPartyConnection(first, first.id)
  registerPartyConnection(next, next.id)
  const joined = await joinPartyRoom(first, { roomId, nickname: 'refresh', characterId: '101' })
  takePresence()
  await removePartyConnection(first, now, { code: 4001, reason: 'page-hide' })
  assert.equal(storedParticipants.get(joined.participantId).departureDeadline, new Date(now + 15_000).toISOString())
  t.mock.timers.tick(14_999)
  assert.equal(leaveNotices(takePresence()).length, 0)
  const resumed = await joinPartyRoom(next, { roomId, nickname: 'refresh', characterId: '101', reconnectToken: joined.reconnectToken })
  assert.equal(resumed.participantId, joined.participantId)
  assert.equal(await recordPartyJoin(next), null)
  assert.equal(storedParticipants.get(joined.participantId).departureDeadline, null)
  t.mock.timers.tick(15_001)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(leaveNotices(takePresence()).length, 0)
  const closedAt = Date.now()
  await removePartyConnection(next, closedAt, { code: 1001, reason: 'going away' })
  t.mock.timers.tick(14_999)
  assert.equal(leaveNotices(takePresence()).length, 0)
  t.mock.timers.tick(1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(leaveNotices(takePresence()).length, 1)
  assert.equal(storedParticipants.get(joined.participantId).leftAt, new Date(closedAt + 15_000).toISOString())
  assert.equal(connectionEvents.findLast(event => event.event === 'leave_notice' && event.participantId === joined.participantId).departure, 'page-hide')
})

test('heartbeat loss keeps a full grace window from detection so a late silent-drop reconnect resumes', async (t) => {
  const now = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const peer = { id: 'heartbeat-deadline', send() {}, close() {} }
  const late = { id: 'heartbeat-late', send() {}, close() {} }
  await createPartyRoom('901002')
  registerPartyConnection(peer, peer.id)
  registerPartyConnection(late, late.id)
  const joined = await joinPartyRoom(peer, { roomId: '901002', nickname: 'heartbeat', characterId: '101' })
  takePresence()
  // 마지막 수신 뒤 60초가 지나 서버가 만료를 감지한다. 이때 바로 퇴장하면 안 된다.
  const detectedAt = now + 60_001
  t.mock.timers.setTime(detectedAt)
  await removePartyConnection(peer, Date.now(), { code: 1013, reason: 'heartbeat-timeout', serverReason: 'heartbeat-timeout' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(leaveNotices(takePresence()).length, 0)
  assert.equal(storedParticipants.get(joined.participantId).departureDeadline, new Date(detectedAt + 60_000).toISOString())
  const disconnect = connectionEvents.findLast(event => event.event === 'disconnect' && event.connectionId === peer.id)
  assert.equal(disconnect.departure, 'loss')
  assert.equal(disconnect.detail.serverReason, 'heartbeat-timeout')

  // 클라이언트가 단절을 늦게(마지막 수신 뒤 약 2분) 알아채고 돌아와도 같은 참여자로 이어진다.
  t.mock.timers.setTime(detectedAt + 59_999)
  const resumed = await joinPartyRoom(late, { roomId: '901002', nickname: 'heartbeat', characterId: '101', reconnectToken: joined.reconnectToken })
  assert.equal(resumed.participantId, joined.participantId)
  assert.equal(await recordPartyJoin(late), null)
  t.mock.timers.tick(60_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(leaveNotices(takePresence()).length, 0)
  await removePartyConnection(late, Date.now(), 'leave')
})

test('shutdown and fresh-module restore preserve IDs, token hashes, history and durable dedupe', async () => {
  const before = await import('../server/utils/party-chat.ts?shutdown-before')
  const after = await import('../server/utils/party-chat.ts?shutdown-after')
  for (const instance of [before, after]) instance.setPartyChatStore(memoryStore)
  const presence = []
  before.setPartyPresenceListener(update => presence.push(update))
  const peer = { id: 'shutdown-before', send() {}, close() {} }
  const roomId = '901003'
  await before.createPartyRoom(roomId)
  before.registerPartyConnection(peer, peer.id)
  const joined = await before.joinPartyRoom(peer, { roomId, nickname: 'durable', characterId: '306', order: 'P3' })
  await before.recordPartyJoin(peer)
  const original = await before.sendPartyChat(peer, { text: 'before restart', clientMessageId: 'restart-dedupe' })
  // Evict this message from BOTH in-memory dedupe and hydrated recent history.
  for (let index = 0; index < 605; index++) {
    await before.sendPartyChat(peer, { text: `later-${index}`, clientMessageId: `later-${index}` })
  }
  const saved = structuredClone(storedParticipants.get(joined.participantId))
  assert.match(saved.reconnectTokenHash, /^[a-f0-9]{64}$/)
  assert.notEqual(saved.reconnectTokenHash, joined.reconnectToken)
  before.beginPartyShutdown()
  await before.removePartyConnection(peer, Date.now(), { code: 1006 })
  await before.finishPartyShutdown()
  assert.deepEqual(storedParticipants.get(joined.participantId), saved)
  assert.deepEqual(presence, [])
  assert.equal(connectionEvents.findLast(event => event.connectionId === peer.id && event.event === 'disconnect').departure, 'shutdown')
  assert.equal(connectionEvents.at(-1).event, 'server_shutdown')

  const resumedPeer = { id: 'shutdown-after', send() {}, close() {} }
  await after.createPartyRoom(roomId)
  assert.equal(after.canResumePartyParticipant(roomId, 'durable', joined.reconnectToken), true)
  assert.equal(after.isPartyNicknameTaken(roomId, 'durable'), true)
  after.registerPartyConnection(resumedPeer, resumedPeer.id)
  const resumed = await after.joinPartyRoom(resumedPeer, { roomId, nickname: 'durable', characterId: '306', order: 'P3', reconnectToken: joined.reconnectToken })
  assert.equal(resumed.participantId, joined.participantId)
  assert.equal(resumed.sessionId, joined.sessionId)
  assert.equal(resumed.reconnectToken, joined.reconnectToken)
  assert.equal(await after.recordPartyJoin(resumedPeer), null)
  assert.equal(resumed.messages.filter(message => message.kind === 'leave').length, 0)
  assert.equal(resumed.messages.at(-1).text, 'later-604')
  const count = storedSessions.get(joined.sessionId).messages.length
  const duplicate = await after.sendPartyChat(resumedPeer, { text: 'changed resend', clientMessageId: 'restart-dedupe' })
  assert.deepEqual(duplicate.message, original.message)
  assert.equal(storedSessions.get(joined.sessionId).messages.length, count)
  const observer = { id: 'restart-observer', send() {}, close() {} }
  after.registerPartyConnection(observer, observer.id)
  const observed = await after.joinPartyRoom(observer, { roomId, nickname: 'observer', characterId: 'spectator' })
  assert.equal(observed.messages.filter(message => message.id === original.message.id).length, 0)
  const event = connectionEvents.findLast(entry => entry.event === 'join' && entry.connectionId === resumedPeer.id)
  assert.equal(event.detail.resumed, true)
  assert.equal(event.detail.restored, true)
  assert.ok(event.detail.disconnectedMs >= 0)
  after.beginPartyShutdown()
  await after.finishPartyShutdown()
})

test('legacy rows are not restored and a past restored deadline produces one durable leave', async (t) => {
  const now = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const source = await import('../server/utils/party-chat.ts?restore-source')
  source.setPartyChatStore(memoryStore)
  const roomId = '901004'
  await source.createPartyRoom(roomId)
  assert.equal(connectionEvents.some(event => event.event === 'room_restored' && event.roomId === roomId), false)
  const peer = { id: 'restore-expired', send() {}, close() {} }
  source.registerPartyConnection(peer, peer.id)
  const joined = await source.joinPartyRoom(peer, { roomId, nickname: 'expired', characterId: '101' })
  await source.removePartyConnection(peer, now, { code: 4001, reason: 'page-hide' })
  source.beginPartyShutdown()
  storedParticipants.set('legacy-no-hash', { id: 'legacy-no-hash', nickname: 'legacy', characterId: '101', order: 'P1', sessionId: joined.sessionId, reconnectTokenHash: null, departureDeadline: null, leftAt: null })
  t.mock.timers.setTime(now + PARTY_LIMITS.pageHideGraceMs + 1)
  const restored = await import('../server/utils/party-chat.ts?restore-expired')
  restored.setPartyChatStore(memoryStore)
  const presence = []
  restored.setPartyPresenceListener(update => presence.push(update))
  await restored.createPartyRoom(roomId)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(restored.isPartyNicknameTaken(roomId, 'legacy'), false)
  assert.equal(restored.isPartyNicknameTaken(roomId, 'expired'), false)
  assert.equal(leaveNotices(presence).length, 1)
  assert.equal(storedSessions.get(joined.sessionId).messages.filter(message => message.kind === 'leave').length, 1)
  assert.equal(connectionEvents.findLast(event => event.event === 'room_restored' && event.roomId === roomId).detail.participants, 1)
  assert.equal(connectionEvents.findLast(event => event.event === 'leave_notice' && event.participantId === joined.participantId).departure, 'restored')
  t.mock.timers.tick(60_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(leaveNotices(presence).length, 1)
  restored.beginPartyShutdown()
  const again = await import('../server/utils/party-chat.ts?restore-expired-again')
  again.setPartyChatStore(memoryStore)
  await again.createPartyRoom(roomId)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(connectionEvents.findLast(event => event.event === 'room_restored' && event.roomId === roomId).detail.participants, 0)
  assert.equal(storedSessions.get(joined.sessionId).messages.filter(message => message.kind === 'leave').length, 1)
  again.beginPartyShutdown()
})

test('a resume admitted inside the grace window keeps its identity when persistence crosses the deadline', async (t) => {
  t.after(() => setPartyChatStore(memoryStore))
  const now = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const roomId = '901101'
  await createPartyRoom(roomId)
  const first = { id: 'deadline-first', send() {}, close() {} }
  const next = { id: 'deadline-next', send() {}, close() {} }
  registerPartyConnection(first, first.id)
  registerPartyConnection(next, next.id)
  const joined = await joinPartyRoom(first, { roomId, nickname: 'deadline', characterId: '101' })
  await removePartyConnection(first, now, { code: 4001, reason: 'page-hide' })
  takePresence()
  t.mock.timers.tick(PARTY_LIMITS.pageHideGraceMs - 1)

  // 저장 중에 유예 마감이 지나고 만료 타이머도 실행되지만, 만료 작업은 이 입장 뒤 큐에 놓인다.
  setPartyChatStore({
    ...memoryStore,
    async upsertParticipant(...args) {
      t.mock.timers.tick(2)
      return memoryStore.upsertParticipant(...args)
    }
  })
  const resumed = await joinPartyRoom(next, { roomId, nickname: 'deadline', characterId: '101', reconnectToken: joined.reconnectToken })
  setPartyChatStore(memoryStore)
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(resumed.ok, true)
  assert.equal(resumed.participantId, joined.participantId)
  assert.equal(resumed.resumed, true)
  assert.equal(leaveNotices(takePresence()).length, 0)
  assert.equal(storedParticipants.get(joined.participantId).leftAt, null)
  assert.equal(storedParticipants.get(joined.participantId).departureDeadline, null)
  await removePartyConnection(next, Date.now(), 'leave')
})

test('a new admission cancelled after persistence is not restorable after a restart', async (t) => {
  t.after(() => setPartyChatStore(memoryStore))
  const roomId = '901102'
  await createPartyRoom(roomId)
  const sessionId = storedRooms.get(roomId).sessionId
  const peer = { id: 'cancelled-admission', send() {}, close() {} }
  registerPartyConnection(peer, peer.id)

  // 참가자 저장 직후 소켓이 닫히는 경우
  setPartyChatStore({
    ...memoryStore,
    async upsertParticipant(...args) {
      await memoryStore.upsertParticipant(...args)
      await removePartyConnection(peer, Date.now(), { code: 1006 })
    }
  })
  const result = await joinPartyRoom(peer, { roomId, nickname: 'cancelled', characterId: '101' })
  setPartyChatStore(memoryStore)

  assert.equal(result.ok, false)
  assert.equal(result.code, 'CONNECTION_CLOSED')
  const orphan = [...storedParticipants.values()].find(item => item.sessionId === sessionId && item.nickname === 'cancelled')
  assert.ok(orphan)
  assert.notEqual(orphan.leftAt, null)
  assert.equal(activeParticipants(sessionId).some(item => item.nickname === 'cancelled'), false)
})

test('party lengths and nickname admission use UTF-16 code units', async (t) => {
  assert.equal(getPartyTextLength('😀'), 2)
  assert.equal(getPartyTextLength('a😀'), 3)
  const nickname = '😀'.repeat(PARTY_MAX_NICKNAME_LENGTH / 2)
  assert.equal(normalizePartyNickname(nickname), nickname)
  assert.equal(normalizePartyNickname(`${nickname}a`), null)
  const peer = { id: 'utf16-lengths', send() {}, close() {} }
  t.after(() => removePartyConnection(peer))
  assert.equal((await createPartyRoom('774411')).ok, true)
  assert.equal(registerPartyConnection(peer, peer.id), true)
  assert.equal((await joinPartyRoom(peer, { roomId: '774411', nickname, characterId: 'spectator' })).ok, true)
  const text = '😀'.repeat(PARTY_MAX_TEXT_LENGTH / 2)
  assert.equal((await sendPartyChat(peer, { text })).ok, true)
  assert.equal((await sendPartyChat(peer, { text: `${text}a` })).code, 'TEXT_TOO_LONG')
  assert.equal((await sendPartyChat(peer, { text: '😀'.repeat(PARTY_MAX_TEXT_LENGTH) })).code, 'TEXT_TOO_LONG')
})

test('join notices survive a failed write and still precede queued chats', async (t) => {
  const writer = { id: 'join-write-failure', send() {}, close() {} }
  const reader = { id: 'join-write-reader', send() {}, close() {} }
  t.after(async () => {
    setPartyChatStore(memoryStore)
    await removePartyConnection(writer)
    await removePartyConnection(reader)
  })
  await createPartyRoom('774412')
  assert.equal(registerPartyConnection(writer, writer.id), true)
  assert.equal((await joinPartyRoom(writer, { roomId: '774412', nickname: '입장', characterId: '101' })).ok, true)
  let release
  let entered
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const started = new Promise((resolve) => {
    entered = resolve
  })
  const originalError = console.error
  const errors = []
  console.error = (...args) => errors.push(args)
  t.after(() => {
    console.error = originalError
  })
  setPartyChatStore({
    ...memoryStore,
    async appendMessage(sessionId, message, leftParticipantId) {
      if (message.kind === 'join') {
        entered()
        await gate
        throw new Error('join storage unavailable')
      }
      return memoryStore.appendMessage(sessionId, message, leftParticipantId)
    }
  })
  const entry = recordPartyJoin(writer)
  assert.equal(entry.notice.kind, 'join')
  assert.deepEqual(entry.peers, [writer])
  await started
  let sent = false
  const chat = sendPartyChat(writer, { text: '입장 다음 메시지' }).then((result) => {
    sent = true
    return result
  })
  await Promise.resolve()
  assert.equal(sent, false)
  release()
  assert.equal((await chat).ok, true)
  assert.equal(errors.length, 1)
  assert.equal(registerPartyConnection(reader, reader.id), true)
  const joined = await joinPartyRoom(reader, { roomId: '774412', nickname: '독자', characterId: '101' })
  assert.deepEqual(joined.messages.map(message => message.kind), ['join', 'chat'])
  assert.equal(joined.messages[0].id, entry.notice.id)
})

test('chat recipients are captured before persistence waits', async (t) => {
  const writer = { id: 'recipient-snapshot-writer', send() {}, close() {} }
  const reader = { id: 'recipient-snapshot-reader', send() {}, close() {} }
  t.after(async () => {
    setPartyChatStore(memoryStore)
    await removePartyConnection(writer)
    await removePartyConnection(reader)
  })
  await createPartyRoom('774413')
  for (const peer of [writer, reader]) {
    assert.equal(registerPartyConnection(peer, peer.id), true)
    assert.equal((await joinPartyRoom(peer, { roomId: '774413', nickname: peer.id.slice(-6), characterId: '101' })).ok, true)
  }
  let release
  let entered
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const started = new Promise((resolve) => {
    entered = resolve
  })
  setPartyChatStore({
    ...memoryStore,
    async appendMessage(...args) {
      entered()
      await gate
      return memoryStore.appendMessage(...args)
    }
  })
  const chat = sendPartyChat(writer, { text: '수신자 스냅샷' })
  await started
  const removal = removePartyConnection(reader)
  release()
  assert.deepEqual((await chat).peers, [writer, reader])
  await removal
})

test('chat recipients include peers admitted ahead of the queued chat', async (t) => {
  const writer = { id: 'recipient-late-writer', send() {}, close() {} }
  const joiner = { id: 'recipient-late-joiner', send() {}, close() {} }
  t.after(async () => {
    setPartyChatStore(memoryStore)
    await removePartyConnection(writer)
    await removePartyConnection(joiner)
  })
  await createPartyRoom('774414')
  assert.equal(registerPartyConnection(writer, writer.id), true)
  assert.equal((await joinPartyRoom(writer, { roomId: '774414', nickname: '작성자', characterId: '101' })).ok, true)
  let release
  let entered
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const started = new Promise((resolve) => {
    entered = resolve
  })
  setPartyChatStore({
    ...memoryStore,
    async upsertParticipant(...args) {
      entered()
      await gate
      return memoryStore.upsertParticipant(...args)
    }
  })
  assert.equal(registerPartyConnection(joiner, joiner.id), true)
  const joining = joinPartyRoom(joiner, { roomId: '774414', nickname: '늦은입장', characterId: '101' })
  await started
  const chat = sendPartyChat(writer, { text: '입장 중 메시지' })
  release()
  const joined = await joining
  assert.equal(joined.ok, true)
  assert.equal(joined.messages.some(message => message.kind === 'chat'), false)
  assert.deepEqual((await chat).peers, [writer, joiner])
})
