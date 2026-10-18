import assert from 'node:assert/strict'
import test from 'node:test'
import { changePartyCharacter, changePartyOrder, createPartyRoom, getPartyHistory, getPartyRoom, isPartyCharacterId, isPartyNicknameTaken, joinPartyRoom, normalizePartyRoomId, PARTY_LIMITS, recordPartyJoin, registerPartyConnection, removePartyConnection, sendPartyChat, setPartyChatStore, touchPartyConnection } from '../server/utils/party-chat.ts'
import { PARTY_CHARACTER_IDS, PARTY_ORDERS, PARTY_UNSELECTED_ID, getPartyCharacterImage } from '../shared/types/party.ts'

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
  const restored = await restarted.joinPartyRoom(restoredPeer, { roomId: '223346', nickname: '미선택 플레이어', characterId: PARTY_UNSELECTED_ID, order: 'P4' })
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
    t.after(() => removePartyConnection(peer))
  }

  assert.equal((await createPartyRoom('556677')).ok, true)
  const initial = await joinPartyRoom(first, { roomId: '556677', nickname: '별붕이', characterId: '101', order: 'P2' })
  assert.equal(initial.ok, true)
  assert.equal(typeof initial.reconnectToken, 'string')
  assert.ok(initial.reconnectToken.length > 0)
  const initialNotice = await recordPartyJoin(first)
  assert.equal(initialNotice?.notice.kind, 'join')

  const firstChat = await sendPartyChat(first, { text: '끊기기 전 메시지', clientMessageId: 'msg-1' })
  assert.equal(firstChat.ok, true)

  // Without the token, a concurrent connection with the same nickname is rejected.
  const rejected = await joinPartyRoom(attacker, { roomId: '556677', nickname: '별붕이', characterId: '101', reconnectToken: 'wrong-token' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'NICKNAME_TAKEN')

  // With the valid reconnectToken, the new connection takes over while the first socket is still open.
  const resumed = await joinPartyRoom(second, {
    roomId: '556677',
    nickname: '별붕이',
    characterId: '101',
    order: 'P2',
    reconnectToken: initial.reconnectToken
  })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.participantId, initial.participantId)
  assert.equal(resumed.reconnectToken, initial.reconnectToken)
  assert.equal(resumed.participants.length, 1)
  assert.equal(firstClosed, true)
  assert.equal(await recordPartyJoin(second), null)
  assert.equal(await removePartyConnection(first), null)
  assert.equal(getPartyRoom('556677')?.participantCount, 1)

  // Updating character on the resumed connection also updates messages sent before reconnecting.
  const changed = await changePartyCharacter(second, '306')
  assert.equal(changed.ok, true)

  // Clean disconnect followed by reconnect with the same token also preserves participantId.
  const leaveResult = await removePartyConnection(second)
  assert.equal(leaveResult?.notice.kind, 'leave')
  const rejoinedAfterClose = await joinPartyRoom(third, {
    roomId: '556677',
    nickname: '별붕이',
    characterId: '306',
    order: 'P2',
    reconnectToken: initial.reconnectToken
  })
  assert.equal(rejoinedAfterClose.ok, true)
  assert.equal(rejoinedAfterClose.participantId, initial.participantId)
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
    await removePartyConnection(peer)
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

  let releaseJoinNotice
  const noticeGate = new Promise((resolve) => {
    releaseJoinNotice = resolve
  })
  let blockJoinNotice = true
  setPartyChatStore({
    ...memoryStore,
    async appendMessage(sessionId, message) {
      if (blockJoinNotice && message.kind === 'join') {
        blockJoinNotice = false
        await noticeGate
      }
      await memoryStore.appendMessage(sessionId, message)
    }
  })

  const joinNoticePromise = recordPartyJoin(peer)
  const leavePromise = removePartyConnection(peer)
  releaseJoinNotice()
  const [joinNoticeResult, leaveResult] = await Promise.all([joinNoticePromise, leavePromise])
  assert.equal(joinNoticeResult?.notice.kind, 'join')
  assert.equal(leaveResult?.notice.kind, 'leave')
})
