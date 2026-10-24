import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { loadPartyModuleUrls } from './test-party-module-loader.mjs'

// Exercise the real crossws node adapter used by h3 and Node 22's global WebSocket.
// Only persistence and Nitro's defineWebSocketHandler global are replaced.
const nuxtRequire = createRequire(createRequire(import.meta.url).resolve('nuxt/package.json'))
const crosswsNodeAdapterUrl = pathToFileURL(
  createRequire(nuxtRequire.resolve('h3')).resolve('crossws/adapters/node')
).href
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
async function transformModule(path, imports = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText.replace(/from (['"])([^'"]+)\1/g, (match, _quote, specifier) => {
    if (imports[specifier]) return `from ${JSON.stringify(imports[specifier])}`
    if (specifier.startsWith('node:')) return match
    throw new Error(`Unmocked import in ${path}: ${specifier}`)
  })
  return moduleUrl(compiled)
}

const typesUrl = await transformModule('shared/types/party.ts')
const { partyChatUrl, limitsUrl, originUrl } = await loadPartyModuleUrls(transformModule, typesUrl, moduleUrl('export const postgresPartyChatStore = undefined'))
const { PARTY_LIMITS } = await import(limitsUrl)
const party = await import(partyChatUrl)
globalThis.defineWebSocketHandler = hooks => hooks
const hooks = (await import(await transformModule('server/routes/ws/party.ts', {
  '../../utils/party-chat': partyChatUrl,
  '../../utils/party-chat-limits': limitsUrl,
  '../../utils/ws-origin': originUrl,
  '../../../shared/types/party': typesUrl
}))).default
const rooms = new Map()
const sessions = new Map()
const participants = new Map()
const events = []
party.setPartyChatStore({
  async openRoom(roomId, sessionId, createdAt, expiresAt) {
    if (!rooms.has(roomId)) {
      const room = { sessionId, createdAt, expiresAt, emptySinceMs: Date.parse(expiresAt) - PARTY_LIMITS.emptyRoomTtlMs, messages: [], participants: [] }
      rooms.set(roomId, room)
      sessions.set(sessionId, room)
    }
    return structuredClone(rooms.get(roomId))
  },
  async findRoom(roomId) { return rooms.has(roomId) ? structuredClone(rooms.get(roomId)) : null },
  async upsertParticipant(sessionId, participant, reconnectTokenHash) { participants.set(participant.id, { ...participant, sessionId, reconnectTokenHash, departureDeadline: null, leftAt: null }) },
  async updateParticipant(participant) { Object.assign(participants.get(participant.id), participant) },
  async setDepartureDeadline(id, deadline) { participants.get(id).departureDeadline = deadline },
  async discardParticipant(id) { participants.get(id).leftAt = new Date().toISOString() },
  async appendMessage(sessionId, message, leftParticipantId) {
    const room = sessions.get(sessionId)
    const existing = room.messages.find(candidate => candidate.id === message.id || (candidate.kind === 'chat' && message.kind === 'chat' && candidate.participant.id === message.participant.id && candidate.clientMessageId === message.clientMessageId))
    if (existing) return structuredClone(existing)
    if (leftParticipantId) participants.get(leftParticipantId).leftAt = message.createdAt
    room.messages.push(structuredClone(message))
    return structuredClone(message)
  },
  async getMessagesBefore() { return { messages: [], hasMore: false } },
  async extendRoom() {},
  async setRoomExpiry() {},
  async deleteRoom() {},
  async deleteExpiredRooms() {},
  async recordConnectionEvent(event) { events.push(structuredClone(event)) },
  async deleteOldConnectionEvents() {}
})
const nodeAdapter = (await import(crosswsNodeAdapterUrl)).default
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('real adapter: loss resume, explicit leave, page-hide grace/resume, silent-drop takeover', { timeout: 18_000 }, async () => {
  const adapter = nodeAdapter({ hooks })
  const server = createServer((_request, response) => response.end())
  server.on('upgrade', (request, socket, head) => adapter.handleUpgrade(request, socket, head))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `ws://127.0.0.1:${server.address().port}/ws/party`
  const clients = []
  function client(nickname) {
    const ws = new WebSocket(url)
    const messages = []
    const listeners = new Set()
    ws.addEventListener('message', (event) => {
      messages.push({ at: Date.now(), ...JSON.parse(event.data) })
      for (const listener of listeners) listener()
    })
    const opened = new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    let closeEvent
    const closed = new Promise(resolve => ws.addEventListener('close', (event) => {
      closeEvent = event
      resolve(event)
    }, { once: true }))
    function waitFor(predicate, timeoutMs = 2_000) {
      const found = messages.find(predicate)
      if (found) return Promise.resolve(found)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check)
          reject(new Error(`${nickname}: timed out waiting for message`))
        }, timeoutMs)
        function check() {
          const message = messages.find(predicate)
          if (!message) return
          clearTimeout(timer)
          listeners.delete(check)
          resolve(message)
        }
        listeners.add(check)
      })
    }
    const result = {
      ws, messages, closed, waitFor, get closeEvent() { return closeEvent },
      async join(reconnectToken) {
        await opened
        ws.send(JSON.stringify({ type: 'JOIN', roomId: '123456', nickname, characterId: 'spectator', order: null, reconnectToken }))
        const message = await waitFor(item => item.type === 'JOINED' || item.type === 'ERROR')
        assert.equal(message.type, 'JOINED')
        return message
      }
    }
    clients.push(result)
    return result
  }
  const notices = (observer, mark) => observer.messages.slice(mark).filter(message => message.type === 'LEAVE_NOTICE' || message.type === 'JOIN_NOTICE')
  try {
    await party.createPartyRoom('123456')
    const observer = client('observer')
    await observer.join()
    const first = client('alice')
    const initial = await first.join()
    await observer.waitFor(message => message.type === 'JOIN_NOTICE' && message.notice.nickname === 'alice')
    let mark = observer.messages.length
    first.ws.close() // Empty close frame -> 1005, classified as connection loss.
    await first.closed
    await sleep(100)
    const second = client('alice')
    const resumed = await second.join(initial.reconnectToken)
    assert.equal(resumed.participantId, initial.participantId)
    await sleep(100)
    assert.deepEqual(notices(observer, mark), [])

    const leaveAt = Date.now()
    second.ws.close(1000, 'leave-room')
    const explicit = await observer.waitFor(message => message.type === 'LEAVE_NOTICE' && message.notice.nickname === 'alice')
    assert.ok(explicit.at - leaveAt < 1_000)
    await second.closed

    const hiding = client('page-expiry')
    const hidden = await hiding.join()
    await observer.waitFor(message => message.type === 'JOIN_NOTICE' && message.notice.nickname === 'page-expiry')
    mark = observer.messages.length
    const hideAt = Date.now()
    hiding.ws.close(4001, 'page-hide')
    await hiding.closed
    await sleep(100)
    // 실제 어댑터가 4001/page-hide를 그대로 넘겨 짧은 유예로 분류되는지만 본다. 만료 시각 동작은 단위 테스트가 검증한다.
    const hiddenDeadline = Date.parse(participants.get(hidden.participantId).departureDeadline) - hideAt
    assert.ok(hiddenDeadline >= PARTY_LIMITS.pageHideGraceMs && hiddenDeadline < PARTY_LIMITS.pageHideGraceMs + 1_000)
    assert.equal(participants.get(hidden.participantId).leftAt, null)
    assert.deepEqual(notices(observer, mark), [])

    const refresh = client('refresh')
    const refreshJoin = await refresh.join()
    await observer.waitFor(message => message.type === 'JOIN_NOTICE' && message.notice.nickname === 'refresh')
    mark = observer.messages.length
    refresh.ws.close(4001, 'page-hide')
    await refresh.closed
    await sleep(100)
    const refreshed = client('refresh')
    assert.equal((await refreshed.join(refreshJoin.reconnectToken)).participantId, refreshJoin.participantId)
    await sleep(100)
    assert.equal(participants.get(refreshJoin.participantId).departureDeadline, null)
    assert.deepEqual(notices(observer, mark), [])

    // The old connection stays open from the server's perspective: no close hook
    // or graceful leave before the replacement JOIN (a silent-drop takeover).
    const takeover = client('refresh')
    const taken = await takeover.join(refreshJoin.reconnectToken)
    assert.equal(taken.participantId, refreshJoin.participantId)
    const replaced = await refreshed.closed
    assert.equal(replaced.code, 1000)
    assert.equal(replaced.reason, 'replaced-by-reconnect')
    await sleep(100)
    assert.deepEqual(notices(observer, mark), [])
    assert.ok(events.some(event => event.event === 'disconnect' && event.departure === 'replaced'))
    assert.ok(events.some(event => event.event === 'disconnect' && event.closeCode === 4001 && event.departure === 'page-hide'))
    assert.ok(events.some(event => event.event === 'join' && event.detail.resumed))
  } finally {
    party.beginPartyShutdown()
    for (const item of clients) {
      if (item.ws.readyState === WebSocket.OPEN) item.ws.close(1000, 'leave-room')
    }
    await Promise.all(clients.map(item => item.closed))
    await party.finishPartyShutdown()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
