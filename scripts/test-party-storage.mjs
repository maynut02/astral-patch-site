import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const origin = new URL(process.argv[2] || 'http://localhost:3000')
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  throw new Error('Party storage tests may only run against a local server.')
}

const sockets = []
async function roomRequest(roomId) {
  const response = await fetch(new URL('/api/party/rooms', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': origin.origin },
    body: JSON.stringify({ roomId })
  })
  assert.equal(response.status, 200, await response.text())
}

async function client() {
  const url = new URL('/ws/party', origin)
  url.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(url, { origin: origin.origin })
  const messages = []
  const listeners = new Set()
  socket.addEventListener('message', (event) => {
    messages.push(JSON.parse(event.data))
    for (const listener of listeners) listener()
  })
  sockets.push(socket)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket did not open')), 10_000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    socket.addEventListener('error', (event) => {
      clearTimeout(timer)
      reject(new Error(`WebSocket connection failed: ${event.message || ''}`))
    }, { once: true })
    socket.addEventListener('close', (event) => {
      clearTimeout(timer)
      reject(new Error(`WebSocket closed before opening: ${event.code} ${event.reason}`))
    }, { once: true })
  })
  return {
    messages,
    send(message) { socket.send(JSON.stringify(message)) },
    wait(predicate, after = 0) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check)
          reject(new Error(`Timed out waiting for party message: ${JSON.stringify(messages.slice(after))}`))
        }, 10_000)
        function check() {
          const found = messages.slice(after).find(predicate)
          if (!found) return
          clearTimeout(timer)
          listeners.delete(check)
          resolve(found)
        }
        listeners.add(check)
        check()
      })
    }
  }
}

const roomId = String(randomInt(0, 1_000_000)).padStart(6, '0')
let otherRoomId
do {
  otherRoomId = String(randomInt(0, 1_000_000)).padStart(6, '0')
} while (otherRoomId === roomId)

try {
  await roomRequest(roomId)
  await roomRequest(otherRoomId)
  const alice = await client()
  const bob = await client()
  const other = await client()

  alice.send({ type: 'JOIN', roomId, nickname: '앨리스', characterId: 'unselected', order: 'P3' })
  const firstJoin = await alice.wait(message => message.type === 'JOINED')
  assert.equal(firstJoin.participants.find(participant => participant.id === firstJoin.participantId).characterId, 'unselected')
  assert.equal(firstJoin.participants.find(participant => participant.id === firstJoin.participantId).order, 'P3')
  await alice.wait(message => message.type === 'JOIN_NOTICE')
  bob.send({ type: 'JOIN', roomId, nickname: '밥', characterId: '101' })
  await bob.wait(message => message.type === 'JOINED')
  other.send({ type: 'JOIN', roomId: otherRoomId, nickname: '다른 방', characterId: 'spectator' })
  await other.wait(message => message.type === 'JOINED')
  const unrelatedId = (await other.wait(message => message.type === 'JOIN_NOTICE')).notice.id

  for (let index = 0; index < 105; index++) {
    const sender = index < 52 ? alice : bob
    const id = randomUUID()
    const offset = sender.messages.length
    sender.send({ type: 'CHAT', text: `${String(index).padStart(3, '0')}${'가'.repeat(997)}`, clientMessageId: id })
    const response = await sender.wait(message => message.type === 'CHAT' && message.message.clientMessageId === id, offset)
    assert.equal(response.message.participant.nickname, index < 52 ? '앨리스' : '밥')
  }

  const offset = alice.messages.length
  alice.send({ type: 'SET_CHARACTER', characterId: '306' })
  const selected = await alice.wait(message => message.type === 'PARTICIPANTS' && message.participants.some(participant => participant.nickname === '앨리스' && participant.characterId === '306'), offset)
  assert.equal(selected.participants.find(participant => participant.nickname === '앨리스').order, 'P3')

  const reader = await client()
  reader.send({ type: 'JOIN', roomId, nickname: '독자', characterId: 'spectator' })
  const joined = await reader.wait(message => message.type === 'JOINED')
  assert.equal(joined.sessionId, firstJoin.sessionId)
  assert.ok(joined.messages.length < 105)
  assert.equal(joined.messages.at(-1).text.slice(0, 3), '104')

  let historyOffset = reader.messages.length
  const before = joined.messages[0].id
  reader.send({ type: 'HISTORY', before })
  const history = await reader.wait(message => message.type === 'HISTORY' && message.before === before, historyOffset)
  assert.ok(history.messages.length > 0 && history.messages.length <= 50)
  assert.ok(history.messages.some(message => message.kind === 'chat' && message.participant.nickname === '앨리스' && message.participant.characterId === '306'))
  assert.ok(history.messages.filter(message => message.kind === 'chat' && message.participant.nickname === '앨리스').every(message => message.participant.order === 'P3'))

  let updateOffset = alice.messages.length
  alice.send({ type: 'SET_CHARACTER', characterId: 'unselected' })
  await alice.wait(message => message.type === 'PARTICIPANTS' && message.participants.some(participant => participant.id === firstJoin.participantId && participant.characterId === 'unselected' && participant.order === 'P3'), updateOffset)
  updateOffset = alice.messages.length
  alice.send({ type: 'SET_ORDER', order: 'P4' })
  await alice.wait(message => message.type === 'PARTICIPANTS' && message.participants.some(participant => participant.id === firstJoin.participantId && participant.characterId === 'unselected' && participant.order === 'P4'), updateOffset)

  historyOffset = reader.messages.length
  reader.send({ type: 'HISTORY', before })
  const waitingHistory = await reader.wait(message => message.type === 'HISTORY' && message.before === before, historyOffset)
  const waitingMessages = waitingHistory.messages.filter(message => message.kind === 'chat' && message.participant.nickname === '앨리스')
  assert.ok(waitingMessages.length > 0)
  assert.ok(waitingMessages.every(message => message.participant.characterId === 'unselected' && message.participant.order === 'P4'))

  const lateReader = await client()
  lateReader.send({ type: 'JOIN', roomId, nickname: '미선택 기록 독자', characterId: 'spectator' })
  const waitingJoin = await lateReader.wait(message => message.type === 'JOINED')
  assert.equal(waitingJoin.sessionId, firstJoin.sessionId)
  const recentWaiting = waitingJoin.messages.filter(message => message.kind === 'chat' && message.participant.nickname === '앨리스')
  assert.ok(recentWaiting.length > 0)
  assert.ok(recentWaiting.every(message => message.participant.characterId === 'unselected' && message.participant.order === 'P4'))

  historyOffset = reader.messages.length
  reader.send({ type: 'HISTORY', before: unrelatedId })
  const unrelated = await reader.wait(message => message.type === 'HISTORY' && message.before === unrelatedId, historyOffset)
  assert.deepEqual(unrelated.messages, [])
  assert.equal(unrelated.hasMore, false)

  console.log(`Verified persisted chat history and room isolation for session ${joined.sessionId}`)
} finally {
  for (const socket of sockets) socket.close()
}
