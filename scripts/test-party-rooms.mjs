import assert from 'node:assert/strict'
import test from 'node:test'
import { changePartyCharacter, changePartyOrder, createPartyRoom, getPartyHistory, getPartyRoom, isPartyNicknameTaken, joinPartyRoom, normalizePartyRoomId, PARTY_LIMITS, recordPartyJoin, registerPartyConnection, removePartyConnection, sendPartyChat, setPartyChatStore, touchPartyConnection } from '../server/utils/party-chat.ts'

// node --experimental-strip-types scripts/test-party-rooms.mjs
const storedRooms = new Map()
const storedSessions = new Map()
const storedParticipants = new Map()
function storedMessage(message) {
  if (message.kind !== 'chat') return structuredClone(message)
  return { ...structuredClone(message), participant: structuredClone(storedParticipants.get(message.participant.id) || message.participant) }
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
    return { sessionId: room.sessionId, createdAt: room.createdAt, expiresAt: room.expiresAt, messages: room.messages.slice(-300).map(storedMessage) }
  },
  async findRoom(roomId) {
    const room = storedRooms.get(roomId)
    if (!room || Date.parse(room.expiresAt) <= Date.now()) return null
    return { sessionId: room.sessionId, createdAt: room.createdAt, expiresAt: room.expiresAt, messages: room.messages.slice(-300).map(storedMessage) }
  },
  async addParticipant(_sessionId, participant) { storedParticipants.set(participant.id, structuredClone(participant)) },
  async updateParticipant(participant) { storedParticipants.set(participant.id, structuredClone(participant)) },
  async appendMessage(sessionId, message) { storedSessions.get(sessionId).messages.push(structuredClone(message)) },
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
  async deleteExpiredRooms() {}
}
setPartyChatStore(memoryStore)

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
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: startedAt })
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

  const longText = '😀'.repeat(1000)
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

test('nicknames are unique within a room and released when the user leaves', async (t) => {
  const first = { id: 'nickname-first', send() {}, close() {} }
  const second = { id: 'nickname-second', send() {}, close() {} }
  const third = { id: 'nickname-third', send() {}, close() {} }
  for (const peer of [first, second, third]) {
    assert.equal(registerPartyConnection(peer, peer.id), true)
    t.after(() => removePartyConnection(peer))
  }
  assert.equal((await createPartyRoom('334455')).ok, true)
  assert.equal((await createPartyRoom('334456')).ok, true)

  assert.equal((await joinPartyRoom(first, { roomId: '334455', nickname: 'Alice', characterId: '101' })).ok, true)
  assert.equal(isPartyNicknameTaken('334455', 'ａｌｉｃｅ'), true)
  assert.equal(isPartyNicknameTaken('334455', 'Bob'), false)
  assert.equal(isPartyNicknameTaken('334456', 'Alice'), false)
  const duplicate = await joinPartyRoom(second, { roomId: '334455', nickname: 'ＡＬＩＣＥ', characterId: '101' })
  assert.equal(duplicate.code, 'NICKNAME_TAKEN')
  assert.equal(getPartyRoom('334455')?.participantCount, 1)
  assert.equal((await joinPartyRoom(second, { roomId: '334456', nickname: 'alice', characterId: '101' })).ok, true)

  const departure = await removePartyConnection(first)
  assert.equal(departure?.notice.kind, 'leave')
  assert.equal(departure?.notice.nickname, 'Alice')
  assert.equal(isPartyNicknameTaken('334455', 'alice'), false)
  assert.equal(await removePartyConnection(first), null)
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
    async appendMessage(sessionId, message) {
      if (message.kind === 'chat' && message.text === '저장 실패') throw new Error('database unavailable')
      await memoryStore.appendMessage(sessionId, message)
    }
  })
  await assert.rejects(sendPartyChat(writer, { text: '저장 실패' }), /database unavailable/)
  setPartyChatStore(memoryStore)
  assert.equal(registerPartyConnection(reader, 'failed-write-reader'), true)
  const joined = await joinPartyRoom(reader, { roomId: '998878', nickname: '독자', characterId: '101' })
  assert.equal(joined.ok, true)
  assert.equal(joined.messages.some(message => message.kind === 'chat' && message.text === '저장 실패'), false)
})
