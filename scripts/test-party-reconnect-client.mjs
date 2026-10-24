import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

// 이 스크립트는 실제 소켓/DB 대신 가짜 WebSocket과 가짜 스토리지로 클라이언트 동작만 검증한다.
const projectRoot = new URL('../', import.meta.url)
const nuxtRequire = createRequire(createRequire(import.meta.url).resolve('nuxt/package.json'))
const vueUrl = pathToFileURL(nuxtRequire.resolve('vue/package.json').replace(/package\.json$/, 'index.mjs')).href

const storageState = { session: new Map(), local: new Map(), throwOn: new Set() }
const fakeStorage = {
  getItem(key) {
    if (storageState.throwOn.has('read')) throw new Error('read failed')
    return storageState.session.has(key) ? storageState.session.get(key) : null
  },
  setItem(key, value) {
    if (storageState.throwOn.has('write')) throw new Error('write failed')
    storageState.session.set(key, String(value))
  },
  removeItem(key) {
    if (storageState.throwOn.has('remove')) throw new Error('remove failed')
    storageState.session.delete(key)
  }
}
const fakeLocalStorage = {
  getItem(key) {
    if (storageState.throwOn.has('read')) throw new Error('read failed')
    return storageState.local.has(key) ? storageState.local.get(key) : null
  },
  setItem(key, value) {
    if (storageState.throwOn.has('write')) throw new Error('write failed')
    storageState.local.set(key, String(value))
  },
  removeItem(key) {
    if (storageState.throwOn.has('remove')) throw new Error('remove failed')
    storageState.local.delete(key)
  }
}

const pageModuleUrl = new URL('app/pages/party/__virtual-room-page.ts', projectRoot).href
const isPageUrl = url => url.includes('__virtual-room-page.ts')
const pagePrefix = `
const __vue = globalThis.__partyTestVue
const { ref, computed, watch, nextTick } = __vue
const onMounted = hook => globalThis.__partyPageHooks.mounted.push(hook)
const onBeforeUnmount = hook => globalThis.__partyPageHooks.unmounted.push(hook)
const definePageMeta = () => {}
const useSeoMeta = () => {}
const useAstralPageSeo = () => {}
const useRoute = () => ({ params: { roomId: globalThis.__partyPageRoomId }, path: '/party/' + globalThis.__partyPageRoomId })
const useState = (key, init) => ref(init ? init() : null)
const useFetch = async () => ({ data: ref([]), error: ref(null), status: ref('success'), refresh: () => {} })
const useTemplateRef = () => ref(null)
const usePartyChat = globalThis.__partyPageUsePartyChat
const usePartyPictureInPicture = () => ({ supported: ref(false), target: ref(null), opening: ref(false), error: ref(null), open() {}, close() {} })
const useAppToast = () => ({ showToast() {} })
const $fetch = globalThis.__partyPageFetch
`

// 실제 래퍼를 그대로 쓰고, Nuxt 빌드 값인 import.meta.client만 window 유무로 바꾼다.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.includes('__virtual-room-page.ts')) {
      return { url: specifier, shortCircuit: true }
    }
    if (specifier === '~' || specifier.startsWith('~/')) {
      const base = `app/${specifier.replace(/^~\//, '')}`
      return { url: new URL(base.endsWith('.ts') ? base : `${base}.ts`, projectRoot).href, shortCircuit: true }
    }
    if (specifier === '#shared/types/party') {
      return { url: new URL('shared/types/party.ts', projectRoot).href, shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('app/utils/browser-storage.ts')) {
      const source = readFileSync(new URL(url), 'utf8').replaceAll('import.meta.client', 'Boolean(globalThis.window)')
      return { format: 'module-typescript', source, shortCircuit: true }
    }
    if (isPageUrl(url)) {
      return { format: 'module-typescript', source: globalThis.__partyPageSource, shortCircuit: true }
    }
    return next(url, context)
  }
})

globalThis.__partyTestStorage = storageState

const vue = await import(vueUrl)
const { ref } = vue

let hookSink = []
globalThis.ref = ref
globalThis.onBeforeUnmount = (hook) => {
  hookSink.push(hook)
}

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = FakeWebSocket.CONNECTING
    this.sent = []
    this.closeCalls = []
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  send(payload) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('socket is not open')
    this.sent.push(JSON.parse(payload))
  }

  close(code, reason) {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.closeCalls.push({ code, reason })
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }

  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  get joinMessages() {
    return this.sent.filter(message => message.type === 'JOIN')
  }
}

globalThis.WebSocket = FakeWebSocket

function createEventTarget() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatch(type, properties = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ type, ...properties })
    }
  }
}

let windowTarget = createEventTarget()
let documentTarget = createEventTarget()
function installDom() {
  windowTarget = createEventTarget()
  windowTarget.localStorage = fakeLocalStorage
  windowTarget.sessionStorage = fakeStorage
  documentTarget = createEventTarget()
  documentTarget.visibilityState = 'visible'
  globalThis.window = windowTarget
  globalThis.document = documentTarget
  globalThis.location = { protocol: 'http:', host: 'localhost:3000' }
}

const partyChatModule = await import(new URL('app/composables/party-chat.ts', projectRoot).href)
const browserStorage = await import(new URL('app/utils/browser-storage.ts', projectRoot).href)
const usePartyChat = partyChatModule.usePartyChat

const RESUME_KEY = 'party-chat-resume'
const roomId = '123456'

function resetStorage() {
  storageState.session.clear()
  storageState.local.clear()
  storageState.throwOn.clear()
}

function resetSockets() {
  FakeWebSocket.instances.length = 0
}

function createChat(targetRoomId = roomId) {
  resetSockets()
  installDom()
  hookSink = []
  const chat = usePartyChat(targetRoomId)
  const context = { chat, hooks: [...hookSink], windowTarget, documentTarget }
  // 실제 하트비트 인터벌이 남지 않도록 테스트마다 정리한다.
  activeContexts.push(context)
  return context
}

const activeContexts = []
test.afterEach(() => {
  // 페이지/컴포저블이 남긴 하트비트와 리스너를 모두 정리해 프로세스가 끝나게 한다.
  if (typeof unmountPage === 'function') unmountPage()
  for (const context of activeContexts.splice(0)) {
    for (const hook of context.hooks) hook()
  }
})

function unmount({ hooks }) {
  for (const hook of hooks) hook()
}

function participant(id, nickname = '앨리스', characterId = '101') {
  return { id, nickname, characterId, order: 'P1' }
}

function chatMessage(id, clientMessageId, nickname = '밥') {
  return {
    kind: 'chat',
    id,
    clientMessageId,
    participant: participant(`p-${nickname}`, nickname, '306'),
    text: '안녕',
    createdAt: new Date().toISOString()
  }
}

function joinedMessage({ sessionId = 'session-1', token = 'token-1', messages = [], participants = [] } = {}) {
  return {
    type: 'JOINED',
    sessionId,
    participantId: 'self',
    reconnectToken: token,
    room: { roomId, participantCount: participants.length, createdAt: new Date().toISOString() },
    messages,
    participants
  }
}

function storeResume(record) {
  storageState.session.set(RESUME_KEY, JSON.stringify(record))
}

function credentials(nickname = '앨리스') {
  return { nickname, characterId: 'spectator', order: null }
}

test('browser storage wrappers select local or session scope safely', () => {
  resetStorage()
  installDom()

  assert.equal(browserStorage.writeBrowserStorage('k', 'local-value'), true)
  assert.equal(browserStorage.writeBrowserStorage('k', 'session-value', 'session'), true)
  assert.equal(browserStorage.readBrowserStorage('k'), 'local-value')
  assert.equal(browserStorage.readBrowserStorage('k', 'session'), 'session-value')
  assert.equal(browserStorage.removeBrowserStorage('k', 'session'), true)
  assert.equal(browserStorage.readBrowserStorage('k', 'session'), null)
  assert.equal(browserStorage.readBrowserStorage('k'), 'local-value')

  storageState.throwOn.add('read')
  storageState.throwOn.add('write')
  storageState.throwOn.add('remove')
  assert.equal(browserStorage.readBrowserStorage('k', 'session'), null)
  assert.equal(browserStorage.writeBrowserStorage('k', 'v', 'session'), false)
  assert.equal(browserStorage.removeBrowserStorage('k', 'session'), false)

  globalThis.window = undefined
  assert.equal(browserStorage.readBrowserStorage('k'), null)
  assert.equal(browserStorage.writeBrowserStorage('k', 'v'), false)
  assert.equal(browserStorage.removeBrowserStorage('k'), false)
})

test('resume record is written only after JOINED and stays out of localStorage', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  assert.deepEqual(socket.joinMessages, [{ type: 'JOIN', roomId, ...credentials(), diagnostics: { attempt: 1 } }])
  assert.equal(storageState.session.has(RESUME_KEY), false)
  assert.equal(storageState.local.has(RESUME_KEY), false)

  socket.receive(joinedMessage())
  assert.equal(storageState.local.has(RESUME_KEY), false)
  const record = JSON.parse(storageState.session.get(RESUME_KEY))
  assert.deepEqual(record, { version: 1, roomId, sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' })
})

test('JOIN carries the stored token and merges the same session without notices', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  storeResume({ version: 1, roomId, sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' })
  const context = createChat()
  const resume = context.chat.getResumeContext('  앨리스 ')
  assert.deepEqual(resume, { reconnectToken: 'token-1', sessionId: 'session-1' })
  context.chat.join(credentials(), resume ?? undefined)

  const socket = FakeWebSocket.instances[0]
  socket.open()
  assert.equal(socket.joinMessages[0].reconnectToken, 'token-1')
  socket.receive(joinedMessage({ messages: [chatMessage('message-1', 'client-1')], participants: [participant('self')] }))
  assert.equal(context.chat.messages.value.length, 1)

  socket.close(1013, 'backpressure')
  t.mock.timers.tick(2_000)
  const resumed = FakeWebSocket.instances.at(-1)
  resumed.open()
  assert.equal(resumed.joinMessages[0].reconnectToken, 'token-1')
  resumed.receive(joinedMessage({ messages: [chatMessage('message-1', 'client-1'), chatMessage('message-2', 'client-2')] }))
  assert.deepEqual(context.chat.messages.value.map(message => message.id), ['message-1', 'message-2'])
})

test('notice events with the same nickname are never merged', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage())
  socket.receive({ type: 'JOIN_NOTICE', notice: { kind: 'join', id: 'notice-1', nickname: '밥', createdAt: new Date().toISOString() } })
  socket.receive({ type: 'JOIN_NOTICE', notice: { kind: 'join', id: 'notice-2', nickname: '밥', createdAt: new Date().toISOString() } })
  assert.deepEqual(context.chat.messages.value.map(message => message.id), ['notice-1', 'notice-2'])
})

test('malformed or throwing storage never blocks a fresh admission', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  storageState.session.set(RESUME_KEY, '{not json')
  const malformed = createChat()
  assert.equal(malformed.chat.getResumeContext('앨리스'), null)
  assert.equal(storageState.session.has(RESUME_KEY), false)
  malformed.chat.join(credentials())
  const malformedSocket = FakeWebSocket.instances[0]
  malformedSocket.open()
  assert.equal(malformedSocket.joinMessages[0].reconnectToken, undefined)

  resetStorage()
  storageState.throwOn.add('read:session')
  storageState.throwOn.add('write:session')
  const throwing = createChat()
  assert.equal(throwing.chat.getResumeContext('앨리스'), null)
  throwing.chat.join(credentials())
  const throwingSocket = FakeWebSocket.instances[0]
  throwingSocket.open()
  throwingSocket.receive(joinedMessage())
  assert.equal(throwing.chat.joined.value, true)
})

test('records from another room or nickname are discarded instead of reused', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  storeResume({ version: 1, roomId: '999999', sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' })
  const otherRoom = createChat()
  assert.equal(otherRoom.chat.getResumeContext('앨리스'), null)
  assert.equal(storageState.session.has(RESUME_KEY), false)

  storeResume({ version: 1, roomId, sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' })
  const otherNickname = createChat()
  assert.equal(otherNickname.chat.getResumeContext('밥'), null)
  assert.equal(storageState.session.has(RESUME_KEY), false)

  storeResume({ version: 1, roomId, sessionId: 'session-1', nicknameKey: 'no-store', reconnectToken: 'token-1' })
  const recordMissingNickname = createChat()
  assert.equal(recordMissingNickname.chat.getResumeContext('앨리스'), null)
})

test('SPA unmount leaves the room but pagehide closes with a resumable short grace', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })

  resetStorage()
  const reload = createChat()
  reload.chat.join(credentials())
  const reloadSocket = FakeWebSocket.instances[0]
  reloadSocket.open()
  reloadSocket.receive(joinedMessage())
  reload.windowTarget.dispatch('pagehide')
  assert.deepEqual(reloadSocket.closeCalls, [{ code: 4001, reason: 'page-hide' }])
  reload.windowTarget.dispatch('online')
  reload.documentTarget.dispatch('visibilitychange')
  t.mock.timers.tick(60_000)
  assert.equal(FakeWebSocket.instances.length, 1)
  unmount(reload)
  assert.equal(reloadSocket.closeCalls.some(call => call.reason === 'leave-room'), false)
  assert.equal(storageState.session.has(RESUME_KEY), true)

  resetStorage()
  const spaLeave = createChat()
  spaLeave.chat.join(credentials())
  const leaveSocket = FakeWebSocket.instances[0]
  leaveSocket.open()
  leaveSocket.receive(joinedMessage())
  unmount(spaLeave)
  assert.deepEqual(leaveSocket.closeCalls, [{ code: 1000, reason: 'leave-room' }])
  assert.equal(storageState.session.has(RESUME_KEY), false)
})

test('a persisted pageshow resumes with the token, then SPA unmount explicitly leaves', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage())
  context.windowTarget.dispatch('pagehide')
  context.windowTarget.dispatch('pageshow', { persisted: false })
  assert.equal(FakeWebSocket.instances.length, 1)
  t.mock.timers.tick(500)
  context.windowTarget.dispatch('pageshow', { persisted: true })
  const restored = FakeWebSocket.instances.at(-1)
  assert.notEqual(restored, socket)
  restored.open()
  assert.equal(restored.joinMessages[0].reconnectToken, 'token-1')
  assert.equal(restored.joinMessages[0].diagnostics.lastCloseCode, 4001)
  assert.equal(restored.joinMessages[0].diagnostics.lastCloseReason, 'page-hide')
  assert.equal(storageState.session.has(RESUME_KEY), true)
  restored.receive(joinedMessage())
  unmount(context)
  assert.deepEqual(restored.closeCalls, [{ code: 1000, reason: 'leave-room' }])
  assert.equal(storageState.session.has(RESUME_KEY), false)
})

test('reconnect backoff caps at five seconds plus jitter and counts connection attempts', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  t.mock.method(Math, 'random', () => 0.5)
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  for (const [index, delay] of [1150, 2150, 4150, 5150, 5150].entries()) {
    const socket = FakeWebSocket.instances.at(-1)
    socket.open()
    assert.equal(socket.joinMessages[0].diagnostics.attempt, index + 1)
    socket.close(1006, '')
    t.mock.timers.tick(delay - 1)
    assert.equal(FakeWebSocket.instances.length, index + 1)
    t.mock.timers.tick(1)
    assert.equal(FakeWebSocket.instances.length, index + 2)
  }
})

test('JOIN diagnostics report the previous close and first-JOIN navigation only', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  t.mock.method(performance, 'getEntriesByType', () => [{ type: 'reload' }])
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
  t.after(() => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else Reflect.deleteProperty(globalThis, 'navigator')
  })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  assert.deepEqual(socket.joinMessages[0].diagnostics, { attempt: 1, navigationType: 'reload' })
  socket.receive(joinedMessage())
  context.documentTarget.visibilityState = 'hidden'
  socket.close(1006, '')
  context.documentTarget.visibilityState = 'visible'
  globalThis.navigator.onLine = true
  t.mock.timers.tick(2_000)
  const resumed = FakeWebSocket.instances.at(-1)
  resumed.open()
  assert.deepEqual(resumed.joinMessages[0].diagnostics, {
    attempt: 1, lastCloseCode: 1006, lastCloseReason: '', lastCloseAgoMs: 2_000,
    hiddenAtClose: true, onlineAtClose: false
  })
  resumed.close(1013, 'backpressure')
  t.mock.timers.tick(3_000)
  const retry = FakeWebSocket.instances.at(-1)
  retry.open()
  assert.deepEqual(retry.joinMessages[0].diagnostics, {
    attempt: 2, lastCloseCode: 1013, lastCloseReason: 'backpressure', lastCloseAgoMs: 3_000,
    hiddenAtClose: false, onlineAtClose: true
  })
})

test('unknown close and navigation diagnostics are omitted', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  t.mock.method(performance, 'getEntriesByType', () => [])
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  assert.deepEqual(socket.joinMessages[0].diagnostics, { attempt: 1 })
  socket.close()
  t.mock.timers.tick(2_000)
  const resumed = FakeWebSocket.instances.at(-1)
  resumed.open()
  const diagnostics = resumed.joinMessages[0].diagnostics
  assert.equal('lastCloseCode' in diagnostics, false)
  assert.equal('lastCloseReason' in diagnostics, false)
  assert.equal('navigationType' in diagnostics, false)
  assert.equal(diagnostics.lastCloseAgoMs, 2_000)
})

test('a transient join cooldown schedules a retry from retryAfterMs', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive({ type: 'ERROR', code: 'JOIN_RATE_LIMITED', message: '입장 시도가 너무 많습니다.', retryAfterMs: 8_000 })

  // 일시적 재시도 힌트는 최종 실패가 아니므로 모달을 여는 코드로 노출되지 않는다.
  assert.equal(context.chat.admissionErrorCode.value, '')
  assert.equal(context.chat.status.value, 'reconnecting')
  assert.equal(FakeWebSocket.instances.length, 1)

  t.mock.timers.tick(7_000)
  assert.equal(FakeWebSocket.instances.length, 1)
  t.mock.timers.tick(1_500)
  assert.equal(FakeWebSocket.instances.length, 2)
})

test('online and visibility events cannot defeat the server cooldown', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive({ type: 'ERROR', code: 'JOIN_RATE_LIMITED', message: '입장 시도가 너무 많습니다.', retryAfterMs: 60_000 })

  context.windowTarget.dispatch('online')
  context.documentTarget.dispatch('visibilitychange')
  assert.equal(FakeWebSocket.instances.length, 1)

  t.mock.timers.tick(30_000)
  context.windowTarget.dispatch('online')
  context.documentTarget.dispatch('visibilitychange')
  assert.equal(FakeWebSocket.instances.length, 1)

  t.mock.timers.tick(30_500)
  assert.equal(FakeWebSocket.instances.length, 2)
})

test('a live nickname conflict stops automatic attempts and offers a deliberate retry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  storeResume({ version: 1, roomId, sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' })
  const context = createChat()
  context.chat.join(credentials(), context.chat.getResumeContext('앨리스') ?? undefined)
  const socket = FakeWebSocket.instances[0]
  socket.open()
  assert.equal(context.chat.recovering.value, true)
  socket.receive({ type: 'ERROR', code: 'NICKNAME_TAKEN', message: '이미 사용 중인 닉네임입니다.' })

  assert.equal(context.chat.status.value, 'error')
  assert.equal(context.chat.admissionErrorCode.value, 'NICKNAME_TAKEN')
  t.mock.timers.tick(120_000)
  assert.equal(FakeWebSocket.instances.length, 1)

  assert.equal(context.chat.retryAdmission(), true)
  assert.equal(FakeWebSocket.instances.length, 2)
})

test('a pending nickname conflict with retryAfterMs keeps waiting automatically', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  storeResume({ version: 1, roomId, sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' })
  const context = createChat()
  context.chat.join(credentials(), context.chat.getResumeContext('앨리스') ?? undefined)
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive({ type: 'ERROR', code: 'NICKNAME_TAKEN', message: '유예 시간까지 기다려 주세요.', retryAfterMs: 10_000 })

  assert.equal(context.chat.status.value, 'reconnecting')
  assert.equal(context.chat.recovering.value, true)
  context.windowTarget.dispatch('online')
  assert.equal(FakeWebSocket.instances.length, 1)
  t.mock.timers.tick(10_500)
  assert.equal(FakeWebSocket.instances.length, 2)
})

test('recovery errors keep the conversation, unconfirmed messages and token', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  assert.equal(context.chat.send('안녕'), true)
  const pendingClientId = context.chat.messages.value.at(-1).clientMessageId

  socket.close(1013, 'backpressure')
  t.mock.timers.tick(2_000)
  const resumed = FakeWebSocket.instances.at(-1)
  resumed.open()
  resumed.receive({ type: 'ERROR', code: 'STORAGE_UNAVAILABLE', message: '기록에 연결하지 못했습니다.', retryAfterMs: 4_000 })

  assert.equal(context.chat.status.value, 'reconnecting')
  const pending = context.chat.messages.value.find(message => message.clientMessageId === pendingClientId)
  assert.equal(pending.delivery, 'unconfirmed')
  assert.equal(storageState.session.has(RESUME_KEY), true)

  t.mock.timers.tick(5_000)
  const retried = FakeWebSocket.instances.at(-1)
  retried.open()
  assert.equal(retried.joinMessages[0].reconnectToken, 'token-1')
})

test('a changed session marks unresolved messages instead of dropping them', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  assert.equal(context.chat.send('남겨야 하는 메시지'), true)
  const pendingClientId = context.chat.messages.value.at(-1).clientMessageId

  socket.close(1013, 'backpressure')
  t.mock.timers.tick(2_000)
  const resumed = FakeWebSocket.instances.at(-1)
  resumed.open()
  resumed.receive(joinedMessage({ sessionId: 'session-2', token: 'token-2', messages: [], participants: [participant('self')] }))

  const retained = context.chat.messages.value.find(message => message.clientMessageId === pendingClientId)
  assert.ok(retained)
  // 자동 재전송할 수 없으므로 다시 입력할 수 있는 실패로 남긴다.
  assert.equal(retained.delivery, 'failed')
  assert.match(retained.failureReason, /세션이 바뀌어/)
  assert.equal(resumed.sent.some(message => message.type === 'CHAT'), false)
  assert.equal(JSON.parse(storageState.session.get(RESUME_KEY)).sessionId, 'session-2')

  resumed.close(1006, '')
  t.mock.timers.tick(2_000)
  const next = FakeWebSocket.instances.at(-1)
  next.open()
  next.receive(joinedMessage({ sessionId: 'session-2', token: 'token-2', participants: [participant('self')] }))
  assert.equal(next.sent.some(message => message.type === 'CHAT'), false)
})

test('a same-session JOINED with a new participant id does not auto-resend under the new identity', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  assert.equal(context.chat.send('이전 신원으로 보낸 메시지'), true)
  const pendingClientId = context.chat.messages.value.at(-1).clientMessageId

  socket.close(1006, '')
  t.mock.timers.tick(2_000)
  const rejoined = FakeWebSocket.instances.at(-1)
  rejoined.open()
  // 유예가 끝나 같은 세션에 새 참여자로 다시 입장한 경우
  rejoined.receive({ ...joinedMessage({ token: 'token-2', participants: [participant('self-2')] }), participantId: 'self-2' })

  const retained = context.chat.messages.value.find(message => message.clientMessageId === pendingClientId)
  assert.ok(retained)
  assert.equal(retained.delivery, 'failed')
  assert.match(retained.failureReason, /새 참여자로/)
  assert.equal(rejoined.sent.some(message => message.type === 'CHAT'), false)
})

test('same-session JOINED resends only unresolved non-rejected messages with their original ids', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  context.chat.send('확인 대기')
  const timedOut = socket.sent.at(-1)
  t.mock.timers.tick(15_000)
  assert.equal(context.chat.messages.value.at(-1).delivery, 'unconfirmed')
  assert.match(context.chat.messages.value.at(-1).failureReason, /자동으로 재전송/)

  context.chat.send('서버 거절')
  const rejected = socket.sent.at(-1)
  socket.receive({ type: 'ERROR', code: 'RATE_LIMITED', message: '잠시 기다려 주세요.', clientMessageId: rejected.clientMessageId })
  context.chat.send('이미 저장됨')
  const confirmed = socket.sent.at(-1)
  context.chat.send('전송 중')
  const sending = socket.sent.at(-1)
  socket.close(1006, '')
  assert.match(context.chat.messages.value.at(-1).failureReason, /자동으로 재전송/)
  t.mock.timers.tick(2_000)
  const resumed = FakeWebSocket.instances.at(-1)
  resumed.open()
  resumed.receive(joinedMessage({
    messages: [chatMessage('stored-1', confirmed.clientMessageId, '앨리스')],
    participants: [participant('self')]
  }))
  assert.deepEqual(resumed.sent.filter(message => message.type === 'CHAT'), [timedOut, sending])
  for (const original of [timedOut, sending]) {
    const local = context.chat.messages.value.find(message => message.clientMessageId === original.clientMessageId)
    assert.equal(local.delivery, 'sending')
    assert.equal(local.failureReason, undefined)
  }
  assert.equal(context.chat.messages.value.find(message => message.clientMessageId === rejected.clientMessageId).delivery, 'failed')
  assert.equal(context.chat.messages.value.filter(message => message.clientMessageId === confirmed.clientMessageId).length, 1)
  t.mock.timers.tick(14_999)
  assert.equal(context.chat.messages.value.at(-1).delivery, 'sending')
  t.mock.timers.tick(1)
  assert.equal(context.chat.messages.value.at(-1).delivery, 'unconfirmed')
})

test('a repeated same-session JOINED resends sending messages and confirmation cancels the restarted timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  context.chat.send('전송 중인 메시지')
  const sent = socket.sent.at(-1)
  t.mock.timers.tick(10_000)
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  assert.deepEqual(socket.sent.filter(message => message.type === 'CHAT'), [sent, sent])
  t.mock.timers.tick(5_000)
  assert.equal(context.chat.messages.value.at(-1).delivery, 'sending')
  socket.receive({ type: 'CHAT', message: chatMessage('confirmed', sent.clientMessageId, '앨리스') })
  t.mock.timers.tick(15_000)
  assert.equal(context.chat.messages.value.length, 1)
  assert.equal('delivery' in context.chat.messages.value[0], false)
})

test('a final recovery failure preserves the conversation and invalidates only the resume context', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  assert.equal(context.chat.send('지켜야 하는 메시지'), true)
  const pendingClientId = context.chat.messages.value.at(-1).clientMessageId

  socket.close(1013, 'backpressure')
  t.mock.timers.tick(2_000)
  const resumed = FakeWebSocket.instances.at(-1)
  resumed.open()
  resumed.receive({ type: 'ERROR', code: 'ROOM_NOT_FOUND', message: '방을 찾을 수 없습니다.' })

  assert.equal(context.chat.status.value, 'error')
  assert.equal(context.chat.admissionErrorCode.value, 'ROOM_NOT_FOUND')
  const retained = context.chat.messages.value.find(message => message.clientMessageId === pendingClientId)
  assert.ok(retained, 'conversation must survive a final recovery failure')
  assert.equal(retained.delivery, 'unconfirmed')
  assert.equal(storageState.session.has(RESUME_KEY), false, 'invalid resume capability is cleared')

  // 명시적 재시도는 저장된 토큰 없이 새 입장으로 나간다.
  assert.equal(context.chat.retryAdmission(), true)
  const retried = FakeWebSocket.instances.at(-1)
  retried.open()
  assert.equal(retried.joinMessages[0].reconnectToken, undefined)
})

test('a transient nickname hint during recovery is not a final admission failure', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  storeResume({ version: 1, roomId, sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' })
  const context = createChat()
  context.chat.join(credentials(), context.chat.getResumeContext('앨리스') ?? undefined)
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive({ type: 'ERROR', code: 'NICKNAME_TAKEN', message: '유예 시간까지 기다려 주세요.', retryAfterMs: 10_000 })

  assert.equal(context.chat.admissionErrorCode.value, '')
  assert.equal(context.chat.status.value, 'reconnecting')
  t.mock.timers.tick(10_500)
  const retried = FakeWebSocket.instances.at(-1)
  retried.open()
  retried.receive(joinedMessage({ participants: [participant('self')] }))
  assert.equal(context.chat.joined.value, true)
  assert.equal(context.chat.admissionErrorCode.value, '')
})

test('the public clearResumeContext drops the stored record and the in-memory token', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  assert.equal(storageState.session.has(RESUME_KEY), true)

  context.chat.clearResumeContext()
  assert.equal(storageState.session.has(RESUME_KEY), false)

  // 페이지가 실제로 호출하는 공개 API를 거쳤으므로 재시도 입장에는 토큰이 실리지 않는다.
  assert.equal(context.chat.retryAdmission(), true)
  const retried = FakeWebSocket.instances.at(-1)
  retried.open()
  assert.equal(retried.joinMessages[0].reconnectToken, undefined)
})

test('send confirmation times out without closing the socket and JOINED has a deadline', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  assert.equal(context.chat.send('확인 없는 메시지'), true)
  t.mock.timers.tick(15_500)
  assert.equal(socket.readyState, FakeWebSocket.OPEN)
  assert.equal(context.chat.messages.value.at(-1).delivery, 'unconfirmed')

  const deadline = createChat()
  deadline.chat.join(credentials())
  const silent = FakeWebSocket.instances[0]
  silent.open()
  t.mock.timers.tick(20_500)
  assert.equal(silent.readyState, FakeWebSocket.CLOSED)
})

// 응답 없는 소켓의 close()는 브라우저가 서버의 종료 확인을 기다리느라 onclose를 바로 내지 않는다.
function hangOnClose(socket) {
  socket.close = (code, reason) => {
    socket.closeCalls.push({ code, reason })
    socket.readyState = FakeWebSocket.CLOSING
  }
}

test('an unresponsive socket is abandoned and reconnected without waiting for the browser close handshake', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000 })
  t.mock.method(Math, 'random', () => 0)
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  hangOnClose(socket)
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  t.mock.timers.tick(40_000)
  assert.equal(socket.closeCalls.length, 0)
  t.mock.timers.tick(20_000)
  assert.deepEqual(socket.closeCalls, [{ code: 4002, reason: 'heartbeat-timeout' }])
  assert.equal(socket.onclose, null)
  assert.equal(context.chat.status.value, 'reconnecting')
  t.mock.timers.tick(1_000)
  assert.equal(FakeWebSocket.instances.length, 2)
  const retry = FakeWebSocket.instances[1]
  hangOnClose(retry)
  retry.open()
  assert.equal(retry.joinMessages[0].reconnectToken, 'token-1')
  assert.equal(retry.joinMessages[0].diagnostics.lastCloseCode, 4002)
  assert.equal(retry.joinMessages[0].diagnostics.lastCloseReason, 'heartbeat-timeout')

  // JOINED가 기한 안에 오지 않는 연결도 onclose를 기다리지 않고 다음 시도로 넘어간다.
  t.mock.timers.tick(20_000)
  assert.deepEqual(retry.closeCalls, [{ code: 4002, reason: 'join-timeout' }])
  t.mock.timers.tick(2_000)
  assert.equal(FakeWebSocket.instances.length, 3)
})

test('returning to the page probes an open socket and replaces it only when nothing answers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000 })
  t.mock.method(Math, 'random', () => 0)
  resetStorage()
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))

  context.documentTarget.dispatch('visibilitychange')
  assert.equal(socket.sent.at(-1).type, 'PING')
  t.mock.timers.tick(1_000)
  socket.receive({ type: 'PONG' })
  t.mock.timers.tick(10_000)
  assert.equal(socket.readyState, FakeWebSocket.OPEN)
  assert.equal(FakeWebSocket.instances.length, 1)

  hangOnClose(socket)
  context.windowTarget.dispatch('online')
  t.mock.timers.tick(4_999)
  assert.equal(socket.closeCalls.length, 0)
  t.mock.timers.tick(1)
  assert.deepEqual(socket.closeCalls, [{ code: 4002, reason: 'liveness-timeout' }])
  assert.equal(context.chat.status.value, 'reconnecting')
  t.mock.timers.tick(1_000)
  assert.equal(FakeWebSocket.instances.length, 2)
  FakeWebSocket.instances[1].open()
  assert.equal(FakeWebSocket.instances[1].joinMessages[0].reconnectToken, 'token-1')
})

// --- 페이지(SFC script) 수준 동작 검증 ---
const pageSfc = readFileSync(new URL('app/pages/party/[roomId].vue', projectRoot), 'utf8')
const pageScript = pageSfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
assert.ok(pageScript, 'party room script setup must remain available to the page harness')
// Nuxt auto-import가 제공하는 심볼을 최소 스텁으로 주입하고 페이지 상태를 노출한다.
globalThis.__partyPageSource = `${pagePrefix}
${pageScript}
export const chatState = {
  get showNicknameModal() { return showNicknameModal },
  get roomError() { return roomError },
  get roomStatus() { return roomStatus },
  get profileReady() { return profileReady },
  get nickname() { return nickname },
  get joined() { return joined },
  get recovering() { return recovering },
  get admissionErrorCode() { return admissionErrorCode },
  get messages() { return messages },
  get submittingNickname() { return submittingNickname }
}
export { refreshRoom, submitNickname }
`

let pageLoadCount = 0
async function loadPage(usePartyChatImpl) {
  globalThis.__partyTestVue = vue
  globalThis.__partyPageRoomId = roomId
  globalThis.__partyPageUsePartyChat = usePartyChatImpl ?? usePartyChat
  globalThis.__partyPageFetch = globalThis.__partyPageFetchImpl
  // 테스트마다 새 모듈 인스턴스를 만들어 이전 테스트의 ref 상태가 새지 않게 한다.
  return import(`${pageModuleUrl}?test=${++pageLoadCount}`)
}

async function flushAsync() {
  // $fetch와 마운트 훅의 마이크로태스크 체인을 모두 소진한다.
  for (let index = 0; index < 8; index++) {
    await Promise.resolve()
    await vue.nextTick()
  }
}

function setupPageEnv({ storedResume, fetchImpl }) {
  resetStorage()
  resetSockets()
  installDom()
  hookSink = []
  globalThis.__partyPageHooks = { mounted: [], unmounted: [] }
  globalThis.__partyPageRequests = []
  if (storedResume) storeResume(storedResume)
  globalThis.__partyPageFetchImpl = async (path, options) => {
    globalThis.__partyPageRequests.push({ path, body: options?.body })
    return fetchImpl(path, options)
  }
}

function runMounted() {
  for (const hook of globalThis.__partyPageHooks.mounted) hook()
}

function unmountPage() {
  for (const hook of globalThis.__partyPageHooks?.unmounted ?? []) hook()
  for (const hook of hookSink) hook()
}

test('page reload precheck sends the stored token and never forces the nickname modal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  setupPageEnv({
    storedResume: { version: 1, roomId, sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' },
    fetchImpl: async () => ({ roomId, participantCount: 1, createdAt: new Date().toISOString() })
  })
  storageState.local.set('party-nickname', '앨리스')
  const page = await loadPage()
  runMounted(page)
  await flushAsync()

  assert.deepEqual(globalThis.__partyPageRequests[0].body, { roomId, nickname: '앨리스', reconnectToken: 'token-1' })
  assert.equal(page.chatState.showNicknameModal.value, false)
  assert.equal(page.chatState.roomStatus.value, 'success')

  // 사전 확인을 통과하면 같은 토큰으로 소켓 입장까지 이어진다.
  const socket = FakeWebSocket.instances[0]
  assert.ok(socket, 'page reconnect opens the party socket')
  socket.open()
  assert.equal(socket.joinMessages[0].reconnectToken, 'token-1')
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  await flushAsync()
  assert.equal(page.chatState.joined.value, true)
  assert.equal(page.chatState.showNicknameModal.value, false)
})

test('page reload precheck conflict clears only the resume record and offers a deliberate choice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  setupPageEnv({
    storedResume: { version: 1, roomId, sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' },
    fetchImpl: async () => {
      throw Object.assign(new Error('conflict'), { statusCode: 409 })
    }
  })
  storageState.local.set('party-nickname', '앨리스')
  const page = await loadPage()
  runMounted(page)
  await flushAsync()

  assert.equal(storageState.session.has(RESUME_KEY), false, 'stale resume record is invalidated')
  assert.equal(page.chatState.showNicknameModal.value, false, 'recovery HTTP conflict must not force the modal')
  assert.equal(page.chatState.roomStatus.value, 'error')
  assert.equal(page.chatState.roomError.value.statusCode, 409)
  assert.ok(page.chatState.roomError.value.message.trim())
})

test('page nickname submit attaches the stored token for a matching context', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  setupPageEnv({
    storedResume: { version: 1, roomId, sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' },
    fetchImpl: async () => ({ roomId, participantCount: 1, createdAt: new Date().toISOString() })
  })
  storageState.local.set('party-nickname', '앨리스')
  const page = await loadPage()
  runMounted(page)
  await flushAsync()
  globalThis.__partyPageRequests.length = 0

  await page.submitNickname()
  assert.deepEqual(globalThis.__partyPageRequests.at(-1).body, { roomId, nickname: '앨리스', reconnectToken: 'token-1' })
  assert.equal(page.chatState.showNicknameModal.value, false)
})

test('page watcher opens the modal only for final conflicts, not retry hints or recovery errors', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  setupPageEnv({
    storedResume: { version: 1, roomId, sessionId: 'session-1', nicknameKey: '앨리스', reconnectToken: 'token-1' },
    fetchImpl: async () => ({ roomId, participantCount: 1, createdAt: new Date().toISOString() })
  })
  storageState.local.set('party-nickname', '앨리스')
  const page = await loadPage()
  runMounted(page)
  await flushAsync()

  const socket = FakeWebSocket.instances[0]
  socket.open()
  // 복구 중 일시적 힌트: 자동 재시도만 예약되고 모달은 열리지 않는다.
  socket.receive({ type: 'ERROR', code: 'NICKNAME_TAKEN', message: '유예 시간까지 기다려 주세요.', retryAfterMs: 5_000 })
  await nextTickVm()
  assert.equal(page.chatState.admissionErrorCode.value, '')
  assert.equal(page.chatState.showNicknameModal.value, false)

  t.mock.timers.tick(5_500)
  const retried = FakeWebSocket.instances.at(-1)
  retried.open()
  // 재시도 기한 없는 지속 충돌은 최종 실패로 기록되지만 복구 중이므로 모달을 강제하지 않는다.
  retried.receive({ type: 'ERROR', code: 'NICKNAME_TAKEN', message: '이미 사용 중인 닉네임입니다.' })
  await nextTickVm()
  assert.equal(page.chatState.recovering.value, true)
  assert.equal(page.chatState.showNicknameModal.value, false)
  assert.equal(page.chatState.admissionErrorCode.value, 'NICKNAME_TAKEN')
})

async function nextTickVm() {
  await vue.nextTick()
  await Promise.resolve()
}

test('UTF-16 composer limits and append notifications stay aligned', () => {
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  socket.receive(joinedMessage({ participants: [participant('self')] }))
  const version = context.chat.appendedMessageVersion.value
  assert.equal(context.chat.send('😀'.repeat(500)), true)
  assert.equal(context.chat.appendedMessageVersion.value, version + 1)
  const outgoing = socket.sent.findLast(message => message.type === 'CHAT')
  socket.receive({ type: 'CHAT', message: { ...chatMessage('confirmed-utf16', outgoing.clientMessageId), text: outgoing.text } })
  assert.equal(context.chat.appendedMessageVersion.value, version + 1)
  assert.equal(context.chat.send('😀'.repeat(501)), false)
  assert.equal(context.chat.send(`${'😀'.repeat(500)}a`), false)
  socket.receive({ type: 'JOIN_NOTICE', notice: { kind: 'join', id: 'new-notice', nickname: '밥', createdAt: new Date().toISOString() } })
  assert.equal(context.chat.appendedMessageVersion.value, version + 2)
})

test('malformed server frames are ignored before they reach client state', () => {
  const context = createChat()
  context.chat.join(credentials())
  const socket = FakeWebSocket.instances[0]
  socket.open()
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args)
  try {
    for (const message of [
      null,
      { type: 'JOINED', participants: null },
      { type: 'CHAT', message: { kind: 'chat' } },
      { type: 'PARTICIPANTS', participants: [null] },
      { type: 'UNKNOWN' }
    ]) socket.receive(message)
    assert.equal(warnings.length, 5)
    assert.equal(context.chat.status.value, 'connecting')
    assert.deepEqual(context.chat.messages.value, [])
    socket.receive(joinedMessage())
    assert.equal(context.chat.status.value, 'connected')
  } finally {
    console.warn = originalWarn
  }
})

test('nickname validation and input attributes share party limits', async () => {
  const { PARTY_MAX_NICKNAME_LENGTH, PARTY_MAX_TEXT_LENGTH, PARTY_ROOM_ID_LENGTH } = await import(new URL('shared/types/party.ts', projectRoot).href)
  const { validatePartyNickname } = await import(new URL('app/utils/party-nickname.ts', projectRoot).href)
  assert.equal(validatePartyNickname('😀'.repeat(PARTY_MAX_NICKNAME_LENGTH / 2)).error, '')
  assert.equal(validatePartyNickname('😀'.repeat(PARTY_MAX_NICKNAME_LENGTH / 2 + 1)).error, `${PARTY_MAX_NICKNAME_LENGTH}자 이내의 닉네임을 입력해 주세요.`)
  assert.equal(PARTY_MAX_TEXT_LENGTH, 1_000)
  assert.equal(PARTY_ROOM_ID_LENGTH, 6)
  const entrySfc = readFileSync(new URL('app/pages/party/index.vue', projectRoot), 'utf8')
  assert.match(entrySfc, /:maxlength="PARTY_ROOM_ID_LENGTH"/)
  assert.match(entrySfc, /:maxlength="PARTY_MAX_NICKNAME_LENGTH"/)
  assert.match(pageSfc, /:maxlength="PARTY_MAX_NICKNAME_LENGTH"/)
  assert.match(pageSfc, /:maxlength="PARTY_MAX_TEXT_LENGTH"/)
})
