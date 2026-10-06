import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import WebSocket from 'ws'

// Run against a local development server: node scripts/test-party-chat.mjs [http://localhost:3000]
const origin = new URL(process.argv[2] || 'http://localhost:3000')
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  throw new Error('Party integration tests may only run against a local server.')
}
const reservedIds = new Set()
function nextRoomId() {
  let id
  do {
    id = String(randomInt(0, 1_000_000)).padStart(6, '0')
  } while (reservedIds.has(id))
  reservedIds.add(id)
  return id
}
const [roomId, otherId, missingId, crossId] = Array.from({ length: 4 }, nextRoomId)
const sockets = []
const roomKeys = ['createdAt', 'participantCount', 'roomId']

async function request(path, body, headers = {}) {
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'origin': origin.origin, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

async function client(path = '/ws/party') {
  const url = new URL(path, origin)
  url.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(url, { origin: origin.origin })
  const messages = []
  const listeners = new Set()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    messages.push(message)
    for (const listener of listeners) listener()
    if (message.type === 'WS_PING' && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'WS_PONG' }))
    }
  })
  sockets.push(ws)
  await once(ws, 'open', { signal: AbortSignal.timeout(10_000) })
  return {
    socket: ws,
    messages,
    send(message) { ws.send(JSON.stringify(message)) },
    close() { ws.close() },
    wait(predicate, after = 0) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check)
          reject(new Error(`WebSocket event timed out. Received: ${JSON.stringify(messages)}`))
        }, 5000)
        function check() {
          const message = messages.slice(after).find(predicate)
          if (!message) return
          clearTimeout(timer)
          listeners.delete(check)
          resolve(message)
        }
        listeners.add(check)
        check()
      })
    },
    waitForNo(predicate, duration = 300, after = 0) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check)
          resolve()
        }, duration)
        function check() {
          const message = messages.slice(after).find(predicate)
          if (!message) return
          clearTimeout(timer)
          listeners.delete(check)
          reject(new Error(`Unexpected WebSocket event: ${JSON.stringify(message)}`))
        }
        listeners.add(check)
        check()
      })
    }
  }
}

function assertRoomSummary(room, id) {
  assert.deepEqual(Object.keys(room).sort(), roomKeys)
  assert.equal(room.roomId, id)
  assert.equal(typeof room.participantCount, 'number')
  assert.equal(typeof room.createdAt, 'string')
}

const profile = { nickname: '테스트 파티원', characterId: '101' }

test('Party HTTP and WebSocket integration', { timeout: 60_000 }, async (t) => {
  t.after(() => {
    for (const socket of sockets) socket.close()
  })

  await t.test('load the complete character catalogue', async () => {
    const result = await request('/api/party/characters')
    assert.equal(result.status, 200)
    assert.equal(result.body.length, 35)
    assert.equal(new Set(result.body.map(character => character.id)).size, 35)
    for (const id of ['101', '129', '301', '306']) {
      const character = result.body.find(item => item.id === id)
      assert.ok(character?.name.trim())
      assert.equal(typeof character.nickname, 'string')
      assert.equal(character.image, `https://file.maynutlab.com/character/UT_Item_Hero_${id}.png`)
    }
  })

  await t.test('entering a room ID creates it or returns the existing room', async () => {
    assert.equal((await request('/api/party/rooms')).status, 404)
    assert.equal((await request(`/api/party/rooms/${missingId}`)).status, 404)
    assert.equal((await request(`/api/party/rooms/${missingId}/password`, { password: '123' })).status, 404)

    const created = await request('/api/party/rooms', { roomId })
    assert.equal(created.status, 200)
    assertRoomSummary(created.body, roomId)
    assert.equal(created.body.participantCount, 0)
    const existing = await request('/api/party/rooms', { roomId })
    assert.equal(existing.status, 200)
    assert.deepEqual(existing.body, created.body)
    assert.equal((await request('/api/party/rooms', { roomId: '../invalid' })).status, 400)
    assert.equal((await request('/api/party/rooms', { roomId, nickname: '' })).status, 400)
    assert.equal((await request('/api/party/rooms', { roomId: otherId, password: '123' })).status, 400)
    assert.equal((await request('/api/party/rooms', { roomId: crossId }, { origin: 'https://example.org' })).status, 403)
    const other = await request('/api/party/rooms', { roomId: otherId })
    assert.equal(other.status, 200)
    assertRoomSummary(other.body, otherId)
  })

  await t.test('shared WebSocket rejects the removed room list topic', async () => {
    const lobby = await client('/ws')
    const closed = once(lobby.socket, 'close', { signal: AbortSignal.timeout(5_000) })
    lobby.send({ type: 'WS_SUBSCRIBE', topics: ['party:rooms'] })
    await closed
    assert.equal(lobby.messages.some(message => message.type === 'PARTY_ROOMS_SNAPSHOT'), false)
  })

  const outsider = await client()
  await t.test('reject chat before joining and invalid profiles', async () => {
    outsider.send({ type: 'CHAT', text: 'unauthorized', clientMessageId: randomUUID() })
    await outsider.wait(message => message.type === 'ERROR')
    let offset = outsider.messages.length
    outsider.send({ type: 'JOIN', roomId, ...profile, nickname: '' })
    await outsider.wait(message => message.type === 'ERROR', offset)
    offset = outsider.messages.length
    outsider.send({ type: 'JOIN', roomId, ...profile, characterId: 'not-a-character' })
    await outsider.wait(message => message.type === 'ERROR', offset)
    offset = outsider.messages.length
    outsider.send({ type: 'JOIN', roomId: missingId, ...profile })
    const missing = await outsider.wait(message => message.type === 'ERROR', offset)
    assert.equal(missing.code, 'ROOM_NOT_FOUND')
    offset = outsider.messages.length
    outsider.send({ type: 'SET_CHARACTER', characterId: '306' })
    assert.equal((await outsider.wait(message => message.type === 'ERROR', offset)).code, 'NOT_IN_ROOM')
    offset = outsider.messages.length
    outsider.send({ type: 'HISTORY', before: randomUUID() })
    assert.equal((await outsider.wait(message => message.type === 'ERROR', offset)).code, 'NOT_IN_ROOM')
    assert.equal(outsider.messages.some(message => message.type === 'JOINED'), false)
  })

  const alice = await client()
  const bob = await client()
  const other = await client()
  let returning
  let aliceId
  await t.test('broadcast presence and chat only inside the joined room', async () => {
    alice.send({ type: 'JOIN', roomId, ...profile, nickname: '앨리스' })
    const aliceJoined = await alice.wait(message => message.type === 'JOINED')
    aliceId = aliceJoined.participantId
    assertRoomSummary(aliceJoined.room, roomId)
    const aliceNotice = await alice.wait(message => message.type === 'JOIN_NOTICE')
    assert.equal(aliceNotice.notice.kind, 'join')
    assert.equal(aliceNotice.notice.nickname, '앨리스')
    const nicknameConflict = await request('/api/party/rooms', { roomId, nickname: '앨리스' })
    assert.equal(nicknameConflict.status, 409)
    assert.match(nicknameConflict.body.message, /이미 사용 중인 닉네임/)
    assert.equal((await request('/api/party/rooms', { roomId, nickname: '밥' })).status, 200)

    const aliceOffset = alice.messages.length
    bob.send({ type: 'JOIN', roomId, ...profile, nickname: '밥', characterId: '306' })
    const bobJoined = await bob.wait(message => message.type === 'JOINED')
    assert.equal(bobJoined.room.participantCount, 2)
    assert.equal(bobJoined.messages.at(-1).id, aliceNotice.notice.id)
    const bobNotice = await bob.wait(message => message.type === 'JOIN_NOTICE' && message.notice.nickname === '밥')
    assert.deepEqual(await alice.wait(message => message.type === 'JOIN_NOTICE' && message.notice.nickname === '밥', aliceOffset), bobNotice)
    await alice.wait(message => message.type === 'PARTICIPANTS' && message.participants.length === 2)

    const duplicate = await client()
    const duplicateOffset = alice.messages.length
    duplicate.send({ type: 'JOIN', roomId, ...profile, nickname: '앨리스' })
    assert.equal((await duplicate.wait(message => message.type === 'ERROR')).code, 'NICKNAME_TAKEN')
    duplicate.close()
    await alice.waitForNo(message => message.type === 'JOIN_NOTICE' || message.type === 'LEAVE_NOTICE', 300, duplicateOffset)

    const outsideOffset = alice.messages.length
    other.send({ type: 'JOIN', roomId: otherId, ...profile })
    await other.wait(message => message.type === 'JOINED')
    await other.wait(message => message.type === 'JOIN_NOTICE')
    await alice.waitForNo(message => message.type === 'JOIN_NOTICE', 300, outsideOffset)

    const id = randomUUID()
    const text = '<script>alert(1)</script>\n한글 채팅 테스트'
    const otherOffset = other.messages.length
    alice.send({ type: 'CHAT', text, clientMessageId: id, participant: { nickname: 'spoofed' } })
    const own = await alice.wait(message => message.type === 'CHAT' && message.message.clientMessageId === id)
    const received = await bob.wait(message => message.type === 'CHAT' && message.message.clientMessageId === id)
    assert.deepEqual(own, received)
    assert.equal(received.message.text, text)
    assert.equal(received.message.participant.nickname, '앨리스')
    assert.equal(received.message.participant.id, aliceId)
    await other.waitForNo(message => message.type === 'CHAT', 300, otherOffset)
  })

  await t.test('change characters inside a joined room and sync message avatars', async () => {
    let offset = alice.messages.length
    alice.send({ type: 'SET_CHARACTER', characterId: 'invalid' })
    assert.equal((await alice.wait(message => message.type === 'ERROR', offset)).code, 'INVALID_CHARACTER')

    offset = alice.messages.length
    const bobOffset = bob.messages.length
    alice.send({ type: 'SET_CHARACTER', characterId: '306' })
    const ownPresence = await alice.wait(message => message.type === 'PARTICIPANTS' && message.participants.some(participant => participant.id === aliceId && participant.characterId === '306'), offset)
    const bobPresence = await bob.wait(message => message.type === 'PARTICIPANTS' && message.participants.some(participant => participant.id === aliceId && participant.characterId === '306'), bobOffset)
    assert.deepEqual(ownPresence, bobPresence)
    assert.equal(ownPresence.participants.find(participant => participant.id === aliceId).nickname, '앨리스')

    const id = randomUUID()
    alice.send({ type: 'CHAT', text: '새 캐릭터로 보낸 메시지', clientMessageId: id })
    const chat = await bob.wait(message => message.type === 'CHAT' && message.message.clientMessageId === id)
    assert.equal(chat.message.participant.characterId, '306')
  })

  await t.test('reject empty, oversized and non-text messages', async () => {
    for (const text of ['', '  ', 'x'.repeat(1001), { image: 'file.png' }]) {
      const id = randomUUID()
      const offset = alice.messages.length
      alice.send({ type: 'CHAT', text, clientMessageId: id })
      const response = await alice.wait(message => message.type === 'ERROR', offset)
      assert.equal(response.clientMessageId, id)
      assert.equal(alice.messages.slice(offset).some(message => message.type === 'CHAT'), false)
    }
  })

  await t.test('rejoin restores history; disconnect removes presence', async () => {
    const offset = alice.messages.length
    const otherOffset = other.messages.length
    bob.close()
    const departure = await alice.wait(message => message.type === 'LEAVE_NOTICE', offset)
    assert.equal(departure.notice.kind, 'leave')
    assert.equal(departure.notice.nickname, '밥')
    await alice.wait(message => message.type === 'PARTICIPANTS' && message.participants.length === 1, offset)
    assert.equal((await request('/api/party/rooms', { roomId, nickname: '밥' })).status, 200)
    await other.waitForNo(message => message.type === 'LEAVE_NOTICE', 300, otherOffset)
    returning = await client()
    returning.send({ type: 'JOIN', roomId, ...profile })
    const joined = await returning.wait(message => message.type === 'JOINED')
    assert.equal(joined.messages.filter(message => message.kind === 'chat').length, 2)
    assert.deepEqual(joined.messages.filter(message => message.kind === 'join').map(message => message.nickname), ['앨리스', '밥'])
    assert.deepEqual(joined.messages.filter(message => message.kind === 'leave').map(message => message.nickname), ['밥'])
    const firstChat = joined.messages.find(message => message.kind === 'chat')
    assert.equal(firstChat.participant.id, aliceId)
    assert.equal(firstChat.participant.characterId, '306')
    assert.equal(joined.participants.length, 2)
  })

  await t.test('spectators cannot choose an order and players can share one', async () => {
    const spectator = await client()
    spectator.send({ type: 'JOIN', roomId, nickname: '관전자', characterId: 'spectator', order: null })
    const joined = await spectator.wait(message => message.type === 'JOINED')
    assert.equal(joined.participants.find(participant => participant.id === joined.participantId).order, null)

    let offset = spectator.messages.length
    spectator.send({ type: 'SET_ORDER', order: 'P2' })
    assert.equal((await spectator.wait(message => message.type === 'ERROR', offset)).code, 'SPECTATOR_ORDER_DISABLED')

    offset = alice.messages.length
    alice.send({ type: 'SET_ORDER', order: 'P2' })
    await alice.wait(message => message.type === 'PARTICIPANTS' && message.participants.some(participant => participant.id === aliceId && participant.order === 'P2'), offset)
    offset = returning.messages.length
    returning.send({ type: 'SET_ORDER', order: 'P2' })
    const shared = await returning.wait(message => message.type === 'PARTICIPANTS' && message.participants.filter(participant => participant.order === 'P2').length === 2, offset)
    assert.equal(shared.participants.filter(participant => participant.order === 'P2').length, 2)

    offset = spectator.messages.length
    spectator.send({ type: 'SET_CHARACTER', characterId: '101' })
    await spectator.wait(message => message.type === 'PARTICIPANTS' && message.participants.some(participant => participant.id === joined.participantId && participant.order === 'P1'), offset)
    offset = spectator.messages.length
    spectator.send({ type: 'SET_CHARACTER', characterId: 'spectator' })
    await spectator.wait(message => message.type === 'PARTICIPANTS' && message.participants.some(participant => participant.id === joined.participantId && participant.order === null), offset)
  })

  await t.test('unselected players retain orders in presence, chat and history', async () => {
    const waitingRoomId = nextRoomId()
    assert.equal((await request('/api/party/rooms', { roomId: waitingRoomId })).status, 200)
    const waiting = await client()
    const observer = await client()
    waiting.send({ type: 'JOIN', roomId: waitingRoomId, nickname: '미선택 플레이어', characterId: 'unselected', order: 'P4' })
    const joined = await waiting.wait(message => message.type === 'JOINED')
    const self = participants => participants.find(participant => participant.id === joined.participantId)
    assert.equal(self(joined.participants).characterId, 'unselected')
    assert.equal(self(joined.participants).order, 'P4')
    observer.send({ type: 'JOIN', roomId: waitingRoomId, nickname: '미선택 관찰자', characterId: 'spectator' })
    await observer.wait(message => message.type === 'JOINED')
    await observer.wait(message => message.type === 'JOIN_NOTICE' && message.notice.nickname === '미선택 관찰자')
    const id = randomUUID()
    waiting.send({ type: 'CHAT', text: '캐릭터 선택 전', clientMessageId: id })
    const chat = await observer.wait(message => message.type === 'CHAT' && message.message.clientMessageId === id)
    assert.equal(chat.message.participant.characterId, 'unselected')
    assert.equal(chat.message.participant.order, 'P4')

    for (const [characterId, order] of [['306', 'P4'], ['unselected', 'P4'], ['spectator', null], ['unselected', 'P1']]) {
      const ownOffset = waiting.messages.length
      const observerOffset = observer.messages.length
      waiting.send({ type: 'SET_CHARACTER', characterId })
      const predicate = message => message.type === 'PARTICIPANTS' && self(message.participants)?.characterId === characterId
      const presence = await waiting.wait(predicate, ownOffset)
      assert.equal(self(presence.participants).order, order)
      assert.deepEqual(await observer.wait(predicate, observerOffset), presence)
    }
    for (const order of ['P1', 'P2', 'P3', 'P4']) {
      const offset = observer.messages.length
      waiting.send({ type: 'SET_ORDER', order })
      await observer.wait(message => message.type === 'PARTICIPANTS' && self(message.participants)?.order === order, offset)
    }
    const offset = waiting.messages.length
    waiting.send({ type: 'SET_ORDER', order: 'P5' })
    assert.equal((await waiting.wait(message => message.type === 'ERROR', offset)).code, 'INVALID_ORDER')

    const lateReader = await client()
    lateReader.send({ type: 'JOIN', roomId: waitingRoomId, nickname: '미선택 기록 독자', characterId: 'spectator' })
    const restored = await lateReader.wait(message => message.type === 'JOINED')
    assert.equal(restored.sessionId, joined.sessionId)
    const savedChat = restored.messages.find(message => message.kind === 'chat' && message.clientMessageId === id)
    assert.equal(savedChat.participant.characterId, 'unselected')
    assert.equal(savedChat.participant.order, 'P4')
    waiting.close()
    observer.close()
    lateReader.close()
  })

  await t.test('bound replayed history by message size', async () => {
    const text = '가'.repeat(1000)
    for (let index = 0; index < 105; index++) {
      const sender = index < 50 ? alice : returning
      const id = randomUUID()
      sender.send({ type: 'CHAT', text, clientMessageId: id })
      await sender.wait(message => message.type === 'CHAT' && message.message.clientMessageId === id)
    }
    const lateArrival = await client()
    lateArrival.send({ type: 'JOIN', roomId, ...profile, nickname: '늦게 온 파티원' })
    const joined = await lateArrival.wait(message => message.type === 'JOINED')
    assert.equal(typeof joined.sessionId, 'string')
    assert.ok(joined.messages.length > 0 && joined.messages.length < 105)
    assert.ok(joined.messages.every(message => message.text === text))
    assert.equal(joined.messages.at(-1).text, text)

    let offset = lateArrival.messages.length
    lateArrival.send({ type: 'HISTORY', before: joined.messages[0].id })
    const history = await lateArrival.wait(message => message.type === 'HISTORY', offset)
    assert.equal(history.before, joined.messages[0].id)
    assert.ok(history.messages.length > 0 && history.messages.length <= 50)
    assert.equal(typeof history.hasMore, 'boolean')
    assert.ok(history.messages.every(message => message.id !== joined.messages[0].id))

    offset = lateArrival.messages.length
    const otherRoomNotice = other.messages.find(message => message.type === 'JOIN_NOTICE').notice.id
    lateArrival.send({ type: 'HISTORY', before: otherRoomNotice })
    const unrelated = await lateArrival.wait(message => message.type === 'HISTORY' && message.before === otherRoomNotice, offset)
    assert.deepEqual(unrelated.messages, [])
    assert.equal(unrelated.hasMore, false)
  })
})
