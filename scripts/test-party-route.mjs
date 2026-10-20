import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { Socket } from 'node:net'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// node --experimental-strip-types scripts/test-party-route.mjs
// Transpile the real WS route and HTTP handler and replace only the WebSocket
// framework global and the storage boundary. No Nuxt server, network or DB.
const require = createRequire(import.meta.url)
const nuxtRequire = createRequire(require.resolve('nuxt/package.json'))
const h3Url = pathToFileURL(nuxtRequire.resolve('h3')).href
const { createEvent } = await import(h3Url)
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

async function transformModule(path, imports = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText.replace(/from (['"])([^'"]+)\1/g, (match, _quote, specifier) => {
    const replacement = specifier === 'h3' ? h3Url : imports[specifier]
    if (replacement) return `from ${JSON.stringify(replacement)}`
    if (specifier.startsWith('node:')) return match
    throw new Error(`Unmocked import in ${path}: ${specifier}`)
  })
  return moduleUrl(compiled)
}

const typesUrl = await transformModule('shared/types/party.ts')
// The store module is only the import-time default; setPartyChatStore replaces it.
const storageStubUrl = moduleUrl('export const postgresPartyChatStore = undefined')
const partyChatUrl = await transformModule('server/utils/party-chat.ts', {
  '../../shared/types/party.ts': typesUrl,
  './party-chat-storage.ts': storageStubUrl
})
const partyChat = await import(partyChatUrl)
const securityUrl = await transformModule('server/utils/request-security.ts')
const wsRouteUrl = await transformModule('server/routes/ws/party.ts', {
  '../../utils/party-chat': partyChatUrl,
  '../../../shared/types/party': typesUrl
})
const roomsRouteUrl = await transformModule('server/api/party/rooms.post.ts', {
  '../../utils/party-chat': partyChatUrl,
  '../../utils/request-security': securityUrl
})

globalThis.defineWebSocketHandler = hooks => hooks
globalThis.defineEventHandler = handler => handler

const memoryStore = buildMemoryStore()
partyChat.setPartyChatStore(memoryStore)

function buildMemoryStore() {
  const rooms = new Map()
  const sessions = new Map()
  const participants = new Map()
  const events = []
  const activeParticipants = sessionId => [...participants.values()].filter(participant => participant.sessionId === sessionId && participant.leftAt === null && participant.reconnectTokenHash != null).map(participant => structuredClone(participant))
  return {
    rooms,
    sessions,
    participants,
    events,
    async openRoom(roomId, sessionId, createdAt, expiresAt) {
      let room = rooms.get(roomId)
      if (!room) {
        room = { roomId, sessionId, createdAt, expiresAt, messages: [] }
        rooms.set(roomId, room)
        sessions.set(sessionId, room)
      }
      return { sessionId: room.sessionId, createdAt: room.createdAt, expiresAt: room.expiresAt, messages: room.messages.map(message => structuredClone(message)), participants: activeParticipants(room.sessionId) }
    },
    async findRoom(roomId) {
      const room = rooms.get(roomId)
      if (!room) return null
      return { sessionId: room.sessionId, createdAt: room.createdAt, expiresAt: room.expiresAt, messages: room.messages.map(message => structuredClone(message)), participants: activeParticipants(room.sessionId) }
    },
    async upsertParticipant(sessionId, participant, reconnectTokenHash) { participants.set(participant.id, { ...structuredClone(participant), sessionId, reconnectTokenHash, departureDeadline: null, leftAt: null }) },
    async updateParticipant(participant) { Object.assign(participants.get(participant.id), structuredClone(participant)) },
    async setDepartureDeadline(participantId, deadline) { participants.get(participantId).departureDeadline = deadline },
    async discardParticipant(participantId) { participants.get(participantId).leftAt = new Date().toISOString() },
    async appendMessage(sessionId, message, leftParticipantId) {
      const room = sessions.get(sessionId)
      const existing = room.messages.find(candidate => candidate.id === message.id || (candidate.kind === 'chat' && message.kind === 'chat' && candidate.participant.id === message.participant.id && candidate.clientMessageId === message.clientMessageId))
      if (existing) return structuredClone(existing)
      if (leftParticipantId) Object.assign(participants.get(leftParticipantId), { leftAt: message.createdAt, departureDeadline: null })
      room.messages.push(structuredClone(message))
      return structuredClone(message)
    },
    async getMessagesBefore() { return { messages: [], hasMore: false } },
    async extendRoom(sessionId, expiresAt) {
      const room = sessions.get(sessionId)
      if (room) room.expiresAt = expiresAt
    },
    async setRoomExpiry(sessionId, expiresAt) {
      const room = sessions.get(sessionId)
      if (room) room.expiresAt = expiresAt
    },
    async deleteRoom(sessionId) { sessions.delete(sessionId) },
    async deleteExpiredRooms() {},
    async recordConnectionEvent(event) { events.push(structuredClone(event)) },
    async deleteOldConnectionEvents() {}
  }
}

const hooks = (await import(wsRouteUrl)).default
const createRoomRoute = (await import(roomsRouteUrl)).default

let peerCounter = 0
function createPeer(ipAddress = 'route-ip') {
  const sent = []
  const closes = []
  peerCounter++
  return {
    id: `route-peer-${peerCounter}`,
    remoteAddress: ipAddress,
    sent,
    closes,
    websocket: {},
    send(payload) { sent.push(JSON.parse(payload)) },
    close(code, reason) { closes.push({ code, reason }) }
  }
}

function lastOfType(peer, type) {
  return [...peer.sent].reverse().find(message => message.type === type)
}

function messagesOfType(peer, type) {
  return peer.sent.filter(message => message.type === type)
}

async function send(peer, message) {
  await hooks.message(peer, { text: () => JSON.stringify(message) })
}

async function join(peer, body) {
  // 방을 먼저 연 뒤 JOIN을 보내 라우트가 입장 경로만 검사하게 한다.
  const roomId = body.roomId
  const created = await partyChat.createPartyRoom(roomId)
  assert.equal(created.ok, true)
  await send(peer, { type: 'JOIN', ...body })
  return lastOfType(peer, 'JOINED')
}

function httpEvent(body, ipAddress) {
  const request = new IncomingMessage(new Socket())
  request.method = 'POST'
  request.url = '/api/party/rooms'
  const payload = JSON.stringify(body)
  request.headers = {
    'host': 'localhost',
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
    'origin': 'http://localhost',
    'x-real-ip': ipAddress
  }
  request.push(payload)
  request.push(null)
  const event = createEvent(request, new ServerResponse(request))
  event.context.params = {}
  return event
}

async function postRoom(body, ipAddress) {
  try {
    return { ok: true, room: await createRoomRoute(httpEvent(body, ipAddress)) }
  } catch (error) {
    return { ok: false, status: error.statusCode, message: error.message }
  }
}

// The HTTP limiter keys on the forwarded address so each test owns its window.
process.env.ASTRAL_TRUST_PROXY = 'true'

function durableMessages(sessionId) {
  return memoryStore.sessions.get(sessionId).messages
}

function durableKinds(sessionId) {
  return durableMessages(sessionId).map(message => message.kind)
}

test('the WS route forwards reconnectToken and resumes live and pending identities', async (t) => {
  t.after(() => partyChat.setPartyChatStore(memoryStore))
  const roomId = '801001'
  const first = createPeer('route-ip-forward')
  const observer = createPeer('route-ip-forward')
  for (const peer of [first, observer]) hooks.open(peer)
  const created = await join(first, { roomId, nickname: '포워드', characterId: '101' })
  assert.equal(typeof created?.reconnectToken, 'string')
  assert.equal(partyChat.isPartyNicknameTaken(roomId, '포워드'), true)

  // 관찰자는 다른 방 참가자로 남아 입·퇴장 공지를 모두 본다.
  await join(observer, { roomId, nickname: '관찰자', characterId: '101' })
  // 관찰자는 자신의 입장 이후 공지만 받는다(소유자 입장은 그 전이었다).
  const observerJoins = messagesOfType(observer, 'JOIN_NOTICE').length
  assert.equal(observerJoins, 1)
  assert.equal(messagesOfType(observer, 'LEAVE_NOTICE').length, 0)

  // 토큰 없이 같은 닉네임을 쓰는 새 소켓은 계속 거부된다.
  const rival = createPeer('route-ip-forward')
  hooks.open(rival)
  await send(rival, { type: 'JOIN', roomId, nickname: '포워드', characterId: '101' })
  assert.equal(lastOfType(rival, 'ERROR').code, 'NICKNAME_TAKEN')
  // 거부된 시도는 관찰자에게 어떤 공지도 만들지 않는다.
  assert.equal(messagesOfType(observer, 'JOIN_NOTICE').length, observerJoins)
  assert.equal(messagesOfType(observer, 'LEAVE_NOTICE').length, 0)

  // forward된 토큰으로 반열림 연결을 인계한다.
  const takeover = createPeer('route-ip-forward')
  hooks.open(takeover)
  const resumed = await join(takeover, {
    roomId,
    nickname: '포워드',
    characterId: '101',
    reconnectToken: created.reconnectToken
  })
  assert.equal(resumed.participantId, created.participantId)
  assert.equal(resumed.reconnectToken, created.reconnectToken)
  assert.deepEqual(first.closes, [{ code: 1000, reason: 'replaced-by-reconnect' }])
  // 인계는 저장된 공지도, 관찰자 공지도 늘리지 않는다.
  assert.deepEqual(durableKinds(created.sessionId), ['join', 'join'])
  assert.equal(messagesOfType(observer, 'JOIN_NOTICE').length, observerJoins)
  assert.equal(messagesOfType(observer, 'LEAVE_NOTICE').length, 0)

  // 인계된 소켓의 close/error는 늦게 도착해도 아무 것도 만들지 않는다.
  await hooks.close(first, { code: 1006 })
  await hooks.error(first, new Error('late error'))
  assert.equal(messagesOfType(takeover, 'LEAVE_NOTICE').length, 0)
  assert.deepEqual(durableKinds(created.sessionId), ['join', 'join'])

  // 손실 뒤 유예 중에도 forward된 토큰으로 재개하고 공지를 억제한다.
  await hooks.close(takeover, { code: 1006 })
  assert.equal(messagesOfType(takeover, 'LEAVE_NOTICE').length, 0)
  assert.equal(messagesOfType(observer, 'LEAVE_NOTICE').length, 0)
  assert.deepEqual(durableKinds(created.sessionId), ['join', 'join'])
  // 손실은 즉시 관찰자에게 참가자 목록만 보낸다.
  assert.equal(partyChat.getPartyRoom(roomId)?.participantCount, 1)

  const pendingPeer = createPeer('route-ip-forward')
  hooks.open(pendingPeer)
  const pendingResume = await join(pendingPeer, {
    roomId,
    nickname: '포워드',
    characterId: '101',
    reconnectToken: created.reconnectToken
  })
  // 닫힌 연결에서도 참가자 ID와 토큰이 그대로 유지된다.
  assert.equal(pendingResume?.participantId, created.participantId)
  assert.equal(pendingResume?.reconnectToken, created.reconnectToken)
  assert.equal(messagesOfType(pendingPeer, 'LEAVE_NOTICE').length, 0)
  assert.deepEqual(durableKinds(created.sessionId), ['join', 'join'])
  assert.equal(messagesOfType(observer, 'LEAVE_NOTICE').length, 0)
  assert.equal(partyChat.getPartyRoom(roomId)?.participantCount, 2)

  // 명시적 퇴장은 정확히 한 건의 저장 공지와 한 번의 관찰자 공지를 만든다.
  await hooks.close(pendingPeer, { code: 1000, reason: 'leave-room' })
  assert.deepEqual(durableKinds(created.sessionId), ['join', 'join', 'leave'])
  assert.equal(messagesOfType(observer, 'LEAVE_NOTICE').length, 1)
  assert.equal(messagesOfType(observer, 'LEAVE_NOTICE')[0].notice.nickname, '포워드')
  await hooks.close(observer, { code: 1000, reason: 'leave-room' })
  assert.deepEqual(durableKinds(created.sessionId), ['join', 'join', 'leave', 'leave'])
})

test('close reasons distinguish an intentional leave from a lost connection', async (t) => {
  t.after(() => partyChat.setPartyChatStore(memoryStore))
  const roomId = '801002'
  const stayer = createPeer('route-ip-reason')
  const leaver = createPeer('route-ip-reason')
  const loser = createPeer('route-ip-reason')
  for (const peer of [stayer, leaver, loser]) hooks.open(peer)

  await join(stayer, { roomId, nickname: '남는이', characterId: '101' })
  await join(leaver, { roomId, nickname: '떠나는이', characterId: '101' })
  await join(loser, { roomId, nickname: '끊긴이', characterId: '101' })
  assert.equal(partyChat.getPartyRoom(roomId)?.participantCount, 3)

  // 의도적 퇴장은 close(1000,'leave-room')에서만 일어난다.
  await hooks.close(leaver, { code: 1000, reason: 'leave-room' })
  const leaveNotices = messagesOfType(stayer, 'LEAVE_NOTICE')
  assert.equal(leaveNotices.length, 1)
  assert.equal(leaveNotices[0].notice.nickname, '떠나는이')
  assert.equal(partyChat.getPartyRoom(roomId)?.participantCount, 2)

  // 정상 종료 코드라도 leave-room 사유가 아니면 손실로 취급한다.
  await hooks.close(loser, { code: 1000, reason: '' })
  assert.equal(messagesOfType(stayer, 'LEAVE_NOTICE').length, 1)
  assert.equal(partyChat.getPartyRoom(roomId)?.participantCount, 1)

  // 중복 close/error는 추가 공지를 만들지 않는다.
  await hooks.close(loser, { code: 1006 })
  await hooks.error(loser, new Error('duplicate'))
  await hooks.close(leaver, { code: 1000, reason: 'leave-room' })
  assert.equal(messagesOfType(stayer, 'LEAVE_NOTICE').length, 1)
  await hooks.close(stayer, { code: 1000, reason: 'leave-room' })
  assert.equal(messagesOfType(stayer, 'LEAVE_NOTICE').length, 1)
})

test('sendError forwards retryAfterMs only for codes that carry it', async (t) => {
  t.after(() => partyChat.setPartyChatStore(memoryStore))
  const limited = createPeer('route-ip-limit')
  hooks.open(limited)
  const input = { roomId: '801003', nickname: '한도', characterId: '101' }
  for (let index = 0; index < partyChat.PARTY_LIMITS.maxJoinAttemptsPerIp; index++) {
    await send(limited, { type: 'JOIN', ...input })
  }
  await send(limited, { type: 'JOIN', ...input })
  const rateError = lastOfType(limited, 'ERROR')
  if (rateError.code !== 'JOIN_RATE_LIMITED') {
    assert.equal(rateError.code, 'JOIN_RATE_LIMITED')
  }
  assert.equal(typeof rateError.retryAfterMs, 'number')
  assert.ok(rateError.retryAfterMs > 0
    && rateError.retryAfterMs <= partyChat.PARTY_LIMITS.joinAttemptWindowMs)
  await hooks.close(limited, { code: 1006 })

  // 라이브 충돌은 필드 자체가 없다. 이는 재시도 가능을 뜻하지 않는다(종료 상태).
  const roomId = '801004'
  const owner = createPeer('route-ip-conflict')
  const attacker = createPeer('route-ip-conflict')
  for (const peer of [owner, attacker]) hooks.open(peer)
  await join(owner, { roomId, nickname: '충돌', characterId: '101' })
  await send(attacker, { type: 'JOIN', roomId, nickname: '충돌', characterId: '101' })
  const conflict = lastOfType(attacker, 'ERROR')
  assert.equal(conflict.code, 'NICKNAME_TAKEN')
  assert.equal('retryAfterMs' in conflict, false)
  await send(attacker, { type: 'CHAT', text: 'x', clientMessageId: 'route-client-id' })
  assert.equal(lastOfType(attacker, 'ERROR').clientMessageId, 'route-client-id')
  for (const peer of [owner, attacker]) await hooks.close(peer, { code: 1000, reason: 'leave-room' })
})

test('the HTTP room handler bypasses the nickname conflict only for a validated owner', async (t) => {
  t.after(() => partyChat.setPartyChatStore(memoryStore))
  const ip = 'route-ip-http'
  const roomId = '801005'
  const peer = createPeer(ip)
  const intruder = createPeer(ip)
  for (const connection of [peer, intruder]) hooks.open(connection)
  const joined = await join(peer, { roomId, nickname: '소유자', characterId: '101' })
  await join(intruder, { roomId, nickname: '침입자', characterId: '101' })

  // 토큰이 없거나 무효면 실제 소유 닉네임도 계속 충돌한다.
  const noToken = await postRoom({ roomId, nickname: '소유자' }, ip)
  assert.equal(noToken.ok, false)
  assert.equal(noToken.status, 409)
  const badToken = await postRoom({ roomId, nickname: '소유자', reconnectToken: 'invalid-token' }, ip)
  assert.equal(badToken.ok, false)
  assert.equal(badToken.status, 409)
  // 유효한 토큰이라도 그 토큰의 소유 닉네임이 아니면 예외가 아니다.
  const otherNickname = await postRoom({ roomId, nickname: '침입자', reconnectToken: joined.reconnectToken }, ip)
  assert.equal(otherNickname.ok, false)
  assert.equal(otherNickname.status, 409)

  // 살아 있는 소유자의 정규화된 닉네임은 통과한다.
  const liveOwner = await postRoom({ roomId, nickname: '소유자', reconnectToken: joined.reconnectToken }, ip)
  assert.equal(liveOwner.ok, true)
  assert.equal(liveOwner.room.roomId, roomId)

  // 유예 중(연결 손실) 예약도 유효한 소유권이다.
  await hooks.close(peer, { code: 1006 })
  assert.equal(partyChat.isPartyNicknameTaken(roomId, '소유자'), true)
  const pendingOwner = await postRoom({ roomId, nickname: '소유자', reconnectToken: joined.reconnectToken }, ip)
  assert.equal(pendingOwner.ok, true)

  // 점유되지 않은 닉네임은 그대로 통과한다.
  const freeNickname = await postRoom({ roomId, nickname: '자유' }, ip)
  assert.equal(freeNickname.ok, true)
})

test('a nickname probe rejected by the precheck still counts against the HTTP limiter', async (t) => {
  t.after(() => partyChat.setPartyChatStore(memoryStore))
  const ip = 'route-ip-http-limit'
  const roomId = '801006'
  const peer = createPeer(ip)
  hooks.open(peer)
  await join(peer, { roomId, nickname: '한도소유자', characterId: '101' })

  // HTTP 제한은 12회/60초로 WS 제한과 별개이며 변경되지 않았다.
  for (let index = 0; index < 12; index++) {
    const attempt = await postRoom({ roomId, nickname: '한도소유자' }, ip)
    assert.equal(attempt.ok, false)
    assert.equal(attempt.status, 409)
  }
  const limited = await postRoom({ roomId, nickname: '자유' }, ip)
  assert.equal(limited.ok, false)
  assert.equal(limited.status, 429)
  await hooks.close(peer, { code: 1000, reason: 'leave-room' })
})

test('WS final ownership validation stays authoritative over an earlier HTTP precheck', async (t) => {
  t.after(() => partyChat.setPartyChatStore(memoryStore))
  const ip = 'route-ip-authority'
  const roomId = '801007'
  const owner = createPeer(ip)
  const later = createPeer(ip)
  const stale = createPeer(ip)
  for (const peer of [owner, later, stale]) hooks.open(peer)

  const joined = await join(owner, { roomId, nickname: '권위', characterId: '101' })
  // HTTP 사전 검사는 이 시점에 통과한다.
  const precheck = await postRoom({ roomId, nickname: '권위', reconnectToken: joined.reconnectToken }, ip)
  assert.equal(precheck.ok, true)

  // 소유자가 명시적으로 퇴장하면 토큰은 무효화되고 닉네임은 풀린다.
  await hooks.close(owner, { code: 1000, reason: 'leave-room' })
  assert.equal(partyChat.canResumePartyParticipant(roomId, '권위', joined.reconnectToken), false)

  const laterJoin = await join(later, { roomId, nickname: '권위', characterId: '101' })
  assert.equal(typeof laterJoin?.participantId, 'string')
  assert.equal(lastOfType(later, 'ERROR'), undefined)
  assert.notEqual(laterJoin.participantId, joined.participantId)

  // 사전 검사를 통과했던 낡은 토큰으로는 WS가 최종 거부한다.
  await send(stale, { type: 'JOIN', roomId, nickname: '권위', characterId: '101', reconnectToken: joined.reconnectToken })
  assert.equal(lastOfType(stale, 'JOINED'), undefined)
  assert.equal(lastOfType(stale, 'ERROR').code, 'NICKNAME_TAKEN')
  assert.equal(partyChat.getPartyRoom(roomId)?.participantCount, 1)

  for (const peer of [later, stale]) await hooks.close(peer, { code: 1000, reason: 'leave-room' })
})

// 저장 경계를 게이트로 막아 await 구간의 경합을 결정적으로 만든다.
function blockedStore(gateName) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const blocked = { release, opened: false }
  partyChat.setPartyChatStore({
    ...memoryStore,
    async upsertParticipant(sessionId, participant, reconnectTokenHash) {
      if (gateName === 'upsertParticipant' && !blocked.opened) {
        blocked.opened = true
        await gate
      }
      await memoryStore.upsertParticipant(sessionId, participant, reconnectTokenHash)
    },
    async extendRoom(sessionId, expiresAt) {
      if (gateName === 'extendRoom' && !blocked.opened) {
        blocked.opened = true
        await gate
      }
      await memoryStore.extendRoom(sessionId, expiresAt)
    },
    async appendMessage(sessionId, message, leftParticipantId) {
      if (gateName === 'appendMessage' && !blocked.opened && message.kind === 'leave') {
        blocked.opened = true
        await gate
      }
      return memoryStore.appendMessage(sessionId, message, leftParticipantId)
    }
  })
  return blocked
}

test('an explicit leave during a blocked admission cannot resurrect the captured identity', async (t) => {
  t.after(() => partyChat.setPartyChatStore(memoryStore))
  const ip = 'route-ip-admission-race'
  const roomId = '801008'
  const owner = createPeer(ip)
  const observer = createPeer(ip)
  for (const peer of [owner, observer]) hooks.open(peer)
  const created = await join(owner, { roomId, nickname: '경합', characterId: '101', order: 'P2' })
  await join(observer, { roomId, nickname: '경합관찰', characterId: '101' })
  const observerJoins = messagesOfType(observer, 'JOIN_NOTICE').length
  const observerLeaves = messagesOfType(observer, 'LEAVE_NOTICE').length

  // 재개 입장을 참가자 저장에서 막고, 그 사이 소유자가 명시적으로 퇴장한다.
  const resumed = createPeer(ip)
  hooks.open(resumed)
  const blocked = blockedStore('upsertParticipant')
  const joinPromise = send(resumed, {
    type: 'JOIN',
    roomId,
    nickname: '경합',
    characterId: '101',
    order: 'P2',
    reconnectToken: created.reconnectToken
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(blocked.opened, true)

  const leavePromise = hooks.close(owner, { code: 1000, reason: 'leave-room' })
  await new Promise(resolve => setImmediate(resolve))
  // 명시적 퇴장은 저장이 막혀 있어도 관찰자에게 참가자 목록을 즉시 보낸다.
  assert.ok(messagesOfType(observer, 'PARTICIPANTS').at(-1).participants.every(entry => entry.nickname !== '경합'))
  blocked.release()
  await Promise.all([joinPromise, leavePromise])
  partyChat.setPartyChatStore(memoryStore)

  // 무효화된 신원을 되살리지 않고 새 참가자로 다시 시작하거나 거부한다.
  const outcome = lastOfType(resumed, 'JOINED') ?? lastOfType(resumed, 'ERROR')
  if (outcome?.type === 'JOINED') {
    assert.notEqual(outcome.participantId, created.participantId)
    assert.notEqual(outcome.reconnectToken, created.reconnectToken)
  } else {
    assert.equal(outcome.code, 'NICKNAME_TAKEN')
  }
  // 관찰자가 보는 공지는 입장 3건(소유자·관찰자·새 참가자) 또는 2건 + 거부, 퇴장은 정확히 1건이다.
  const leavesAfter = messagesOfType(observer, 'LEAVE_NOTICE')
  assert.equal(leavesAfter.length, observerLeaves + 1)
  assert.equal(leavesAfter[0].notice.nickname, '경합')
  assert.equal(
    messagesOfType(observer, 'JOIN_NOTICE').length,
    observerJoins + (outcome?.type === 'JOINED' ? 1 : 0)
  )
  // 저장된 트랜스크립트도 같은 결론을 보인다: 퇴장 1건, 재개로 인한 추가 입장 없음.
  assert.equal(durableKinds(created.sessionId).filter(kind => kind === 'leave').length, 1)
  assert.equal(partyChat.isPartyNicknameTaken(roomId, '경합'), outcome?.type === 'JOINED')
  await hooks.close(resumed, { code: 1000, reason: 'leave-room' })
  await hooks.close(observer, { code: 1000, reason: 'leave-room' })
})

test('a loss during a blocked admission keeps the same token resumable', async (t) => {
  t.after(() => partyChat.setPartyChatStore(memoryStore))
  const ip = 'route-ip-admission-loss'
  const roomId = '801009'
  const owner = createPeer(ip)
  const observer = createPeer(ip)
  for (const peer of [owner, observer]) hooks.open(peer)
  const created = await join(owner, { roomId, nickname: '손실경합', characterId: '101' })
  await join(observer, { roomId, nickname: '손실관찰', characterId: '101' })
  const observerLeaves = messagesOfType(observer, 'LEAVE_NOTICE').length

  // 재개 입장을 막고, 그 사이 기존 소켓이 손실로 전환된다(명시적 무효화가 아님).
  const resumed = createPeer(ip)
  hooks.open(resumed)
  const blocked = blockedStore('upsertParticipant')
  const joinPromise = send(resumed, {
    type: 'JOIN',
    roomId,
    nickname: '손실경합',
    characterId: '101',
    reconnectToken: created.reconnectToken
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(blocked.opened, true)

  const lossPromise = hooks.close(owner, { code: 1006 })
  await new Promise(resolve => setImmediate(resolve))
  blocked.release()
  await Promise.all([joinPromise, lossPromise])
  partyChat.setPartyChatStore(memoryStore)

  // 손실→유예 전환은 같은 토큰/ID로 계속 유효하므로 재개가 성립한다.
  const joined = lastOfType(resumed, 'JOINED')
  assert.equal(joined?.participantId, created.participantId)
  assert.equal(joined?.reconnectToken, created.reconnectToken)
  // 재개는 퇴장 공지를 만들지 않고, 손실도 즉시 퇴장으로 확정되지 않는다.
  assert.equal(messagesOfType(observer, 'LEAVE_NOTICE').length, observerLeaves)
  assert.equal(durableKinds(created.sessionId).filter(kind => kind === 'leave').length, 0)
  assert.equal(partyChat.getPartyRoom(roomId)?.participantCount, 2)
  await hooks.close(resumed, { code: 1000, reason: 'leave-room' })
  await hooks.close(observer, { code: 1000, reason: 'leave-room' })
})

test('a blocked explicit leave publishes observer presence, then exactly one durable leave', async (t) => {
  t.after(() => partyChat.setPartyChatStore(memoryStore))
  const ip = 'route-ip-blocked-leave'
  const roomId = '801010'
  const leaver = createPeer(ip)
  const observer = createPeer(ip)
  for (const peer of [leaver, observer]) hooks.open(peer)
  const joined = await join(leaver, { roomId, nickname: '차단퇴장', characterId: '101' })
  await join(observer, { roomId, nickname: '차단관찰', characterId: '101' })
  const observerLeaves = messagesOfType(observer, 'LEAVE_NOTICE').length
  assert.equal(observerLeaves, 0)

  const blocked = blockedStore('appendMessage')
  const closePromise = hooks.close(leaver, { code: 1000, reason: 'leave-room' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(blocked.opened, true)

  // 퇴장 저장이 막혀 있어도 관찰자는 즉시 갱신된 참가자 목록을 받고, 공지는 아직 없다.
  assert.equal(partyChat.getPartyRoom(roomId)?.participantCount, 1)
  assert.deepEqual(messagesOfType(observer, 'PARTICIPANTS').at(-1).participants.map(entry => entry.nickname), ['차단관찰'])
  assert.equal(messagesOfType(observer, 'LEAVE_NOTICE').length, 0)
  assert.equal(durableKinds(joined.sessionId).filter(kind => kind === 'leave').length, 0)

  blocked.release()
  await closePromise
  partyChat.setPartyChatStore(memoryStore)
  // 저장이 성공한 뒤 정확히 한 번의 퇴장 공지가 나간다.
  const leaves = messagesOfType(observer, 'LEAVE_NOTICE')
  assert.equal(leaves.length, 1)
  assert.equal(leaves[0].notice.nickname, '차단퇴장')
  assert.equal(durableKinds(joined.sessionId).filter(kind => kind === 'leave').length, 1)
  await hooks.close(observer, { code: 1000, reason: 'leave-room' })
})

test('an invalidated owner during a blocked admission cannot admit a fresh participant without budget', async (t) => {
  t.after(() => partyChat.setPartyChatStore(memoryStore))
  const ip = 'route-ip-fallback-budget'
  const roomId = '801011'
  const owner = createPeer(ip)
  const observer = createPeer(ip)
  for (const peer of [owner, observer]) hooks.open(peer)
  const created = await join(owner, { roomId, nickname: '폴백', characterId: '101' })
  await join(observer, { roomId, nickname: '폴백관찰', characterId: '101' })
  const observerJoins = messagesOfType(observer, 'JOIN_NOTICE').length

  // 이 IP의 새 입장 예산을 완전히 소진한다(토큰 없는 시도로만).
  while (true) {
    const peer = createPeer(ip)
    hooks.open(peer)
    await send(peer, { type: 'JOIN', roomId: '801012', nickname: '소진', characterId: '101' })
    const error = lastOfType(peer, 'ERROR')
    await hooks.close(peer, { code: 1006 })
    if (error?.code === 'JOIN_RATE_LIMITED') {
      assert.ok(error.retryAfterMs > 0)
      break
    }
    assert.equal(error?.code, 'ROOM_NOT_FOUND')
  }

  // 재개 입장을 참가자 저장에서 막고, 그 사이 소유자가 명시적으로 퇴장해 신원을 무효화한다.
  const resumed = createPeer(ip)
  hooks.open(resumed)
  const blocked = blockedStore('upsertParticipant')
  const joinPromise = send(resumed, {
    type: 'JOIN',
    roomId,
    nickname: '폴백',
    characterId: '101',
    reconnectToken: created.reconnectToken
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(blocked.opened, true)

  const leavePromise = hooks.close(owner, { code: 1000, reason: 'leave-room' })
  await new Promise(resolve => setImmediate(resolve))
  blocked.release()
  await Promise.all([joinPromise, leavePromise])
  partyChat.setPartyChatStore(memoryStore)

  // 신원이 무효화됐고 예산도 없으므로 새 참가자를 무료로 들여보내지 않는다.
  const error = lastOfType(resumed, 'ERROR')
  assert.equal(error?.code, 'JOIN_RATE_LIMITED')
  assert.ok(error.retryAfterMs > 0
    && error.retryAfterMs <= partyChat.PARTY_LIMITS.joinAttemptWindowMs)
  assert.equal(lastOfType(resumed, 'JOINED'), undefined)
  assert.equal(partyChat.getPartyRoom(roomId)?.participantCount, 1)
  // 관찰자에게는 새 입장 공지도, 추가 퇴장 공지도 생기지 않는다(퇴장은 정확히 1건).
  assert.equal(messagesOfType(observer, 'JOIN_NOTICE').length, observerJoins)
  assert.deepEqual(
    durableKinds(created.sessionId).filter(kind => kind !== 'chat'),
    ['join', 'join', 'leave']
  )
  await hooks.close(resumed, { code: 1006 })
  await hooks.close(observer, { code: 1000, reason: 'leave-room' })
})

test('route logs sanitized diagnostics, never-joined closes and server close reasons', async () => {
  const peer = createPeer('diagnostic-ip')
  peer.request = new Request('http://localhost/ws/party', { headers: { 'user-agent': 'x'.repeat(300) } })
  hooks.open(peer)
  const connected = memoryStore.events.findLast(event => event.event === 'connect' && event.connectionId === peer.id)
  assert.equal(connected.detail.userAgent, 'x'.repeat(256))
  await send(peer, { type: 'JOIN', roomId: '999990', nickname: 'unknown', characterId: '101' })
  assert.equal(memoryStore.events.findLast(event => event.event === 'join_rejected').detail.code, 'ROOM_NOT_FOUND')
  await hooks.message(peer, { text: () => 'not JSON' })
  const disconnected = memoryStore.events.findLast(event => event.event === 'disconnect' && event.connectionId === peer.id)
  assert.equal(disconnected.departure, 'not-joined')
  assert.equal(disconnected.closeCode, 1003)
  assert.equal(disconnected.detail.serverReason, 'invalid-json')
  assert.ok(disconnected.connectedMs >= 0)
  await hooks.close(peer, { code: 1003, reason: 'invalid-json' })
  assert.equal(memoryStore.events.filter(event => event.event === 'disconnect' && event.connectionId === peer.id).length, 1)
  const member = createPeer('diagnostic-member')
  hooks.open(member)
  await join(member, {
    roomId: '801020', nickname: 'diagnostics', characterId: '101',
    diagnostics: {
      attempt: 2, lastCloseCode: 1006, lastCloseAgoMs: 123, hiddenAtClose: false, onlineAtClose: true,
      lastCloseReason: 'loss', navigationType: 'reload', ip: '127.0.0.1', extra: {},
      constructor: 'bad'
    }
  })
  const joined = memoryStore.events.findLast(event => event.event === 'join' && event.connectionId === member.id)
  assert.deepEqual(joined.detail.diagnostics, {
    attempt: 2, lastCloseCode: 1006, lastCloseAgoMs: 123, hiddenAtClose: false, onlineAtClose: true,
    lastCloseReason: 'loss', navigationType: 'reload'
  })
  await hooks.close(member, { code: 4001, reason: 'page-hide' })
  const resumed = createPeer('diagnostic-resumed')
  hooks.open(resumed)
  const initial = lastOfType(member, 'JOINED')
  await join(resumed, {
    roomId: '801020', nickname: 'diagnostics', characterId: '101', reconnectToken: initial.reconnectToken,
    diagnostics: { attempt: -1, lastCloseCode: '1006', lastCloseAgoMs: Infinity, hiddenAtClose: 1, onlineAtClose: null, lastCloseReason: 'x'.repeat(65), navigationType: [] }
  })
  const resumedEvent = memoryStore.events.findLast(event => event.event === 'join' && event.connectionId === resumed.id)
  assert.deepEqual(resumedEvent.detail.diagnostics, {})
  assert.equal(resumedEvent.detail.resumed, true)
  assert.ok(resumedEvent.detail.disconnectedMs >= 0)
  assert.equal(memoryStore.events.findLast(event => event.event === 'disconnect' && event.connectionId === member.id).departure, 'page-hide')
  await hooks.close(resumed, { code: 1000, reason: 'leave-room' })
})

test('signal plugin synchronously suppresses departures and drains writes on Nitro close', async () => {
  const isolatedUrl = `${partyChatUrl}#signal-plugin`
  const isolated = await import(isolatedUrl)
  isolated.setPartyChatStore(memoryStore)
  globalThis.defineNitroPlugin = plugin => plugin
  const plugin = (await import(await transformModule('server/plugins/party-chat-cleanup.ts', {
    '../utils/party-chat': isolatedUrl,
    '../utils/party-chat-storage': storageStubUrl
  }))).default
  let closeHook
  const previousTerm = process.listeners('SIGTERM')
  const previousInt = process.listeners('SIGINT')
  plugin({
    hooks: {
      hook(name, callback) {
        assert.equal(name, 'close')
        closeHook = callback
      }
    }
  })
  const onTerm = process.listeners('SIGTERM').find(listener => !previousTerm.includes(listener))
  const onInt = process.listeners('SIGINT').find(listener => !previousInt.includes(listener))
  assert.equal(typeof onTerm, 'function')
  assert.equal(typeof onInt, 'function')
  const peer = createPeer('signal-member')
  await isolated.createPartyRoom('801021')
  isolated.registerPartyConnection(peer, 'signal-member')
  const joined = await isolated.joinPartyRoom(peer, { roomId: '801021', nickname: 'signal', characterId: '101' })
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  isolated.setPartyChatStore({
    ...memoryStore,
    async appendMessage(...args) {
      await gate
      return memoryStore.appendMessage(...args)
    }
  })
  const write = isolated.sendPartyChat(peer, { text: 'drain on shutdown' })
  onTerm()
  onInt()
  await isolated.removePartyConnection(peer, Date.now(), { code: 1006 })
  const saved = memoryStore.participants.get(joined.participantId)
  assert.equal(saved.departureDeadline, null)
  assert.equal(saved.leftAt, null)
  let closed = false
  const closing = closeHook().then(() => {
    closed = true
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closed, false)
  release()
  await Promise.all([write, closing])
  assert.equal(memoryStore.events.at(-1).event, 'server_shutdown')
  assert.deepEqual(durableKinds(joined.sessionId), ['chat'])
  process.removeListener('SIGTERM', onTerm)
  process.removeListener('SIGINT', onInt)
})
