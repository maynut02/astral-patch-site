import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const nuxtRequire = createRequire(require.resolve('nuxt/package.json'))
const { computed, effectScope, ref, watch } = nuxtRequire('vue')
const compiled = ts.transpileModule(await readFile(new URL('../app/composables/change-log-realtime.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function entry(id, publication = null, proposedText = id) {
  return { id, publication, proposedText, status: 'approved', createdAt: '2026-10-27T00:00:00Z' }
}

function page(entries) {
  return { entries, total: entries.length, page: 1, pageSize: 50, totalPages: 1 }
}

function harness(context) {
  const handlers = new Map()
  const requests = []
  const timers = new Map()
  let timerId = 0
  const data = ref(page([entry('a'), entry('b')]))
  const fetch = (url) => {
    if (url === '/api/editor/log/summary') return Promise.resolve({ approved: 2, pending: 0, rejected: 0, superseded: 0 })
    if (url === '/api/editor/overview') return Promise.resolve({})
    return new Promise((resolve) => {
      requests.push({ url, resolve, consumed: false })
    })
  }
  const module = { exports: {} }
  runInNewContext(compiled, {
    module, exports: module.exports, watch,
    require: () => ({ ALL_STATUS_VALUE: '__all_status__' }),
    $fetch: fetch,
    useAstralWebSocket: () => ({
      onMessage: (type, handler) => handlers.set(type, handler),
      onReconnect: () => {}
    }),
    setTimeout: (callback) => {
      timers.set(++timerId, callback)
      return timerId
    },
    clearTimeout: id => timers.delete(id),
    onBeforeUnmount: () => {}
  })
  const scope = effectScope()
  context.after(() => scope.stop())
  scope.run(() => module.exports.useChangeLogRealtime({
    translationData: data,
    translationSummaryData: ref(null), overviewData: ref(null), translationStatus: ref('success'),
    translationQuery: computed(() => ({ page: 1, search: undefined, status: undefined })),
    translationSearch: ref(''), translationStatusFilter: ref('__all_status__'), translationPage: ref(1),
    defaultTranslationData: page([]),
    refreshTranslations: async () => {
      data.value = await fetch('/api/editor/log/translations')
    }
  }))
  return {
    data,
    emit(type, changeId) {
      handlers.get(type)({ type, changeId })
    },
    flushTimer() {
      const callbacks = [...timers.values()]
      timers.clear()
      callbacks.forEach(callback => callback())
    },
    async take(url) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const request = requests.find(item => item.url === url && !item.consumed)
        if (request) {
          request.consumed = true
          return request
        }
        await new Promise(resolve => setImmediate(resolve))
      }
      throw new Error(`No request for ${url}`)
    }
  }
}

const publication = { number: 2, gameVersion: '3.3.0', revision: '012' }
const settle = () => new Promise(resolve => setImmediate(resolve))

test('a review arriving during publication refresh cannot leave unrelated approvals marked undeployed', async (context) => {
  const h = harness(context)
  h.emit('TRANSLATION_PACK_PUBLISHED')
  const full = await h.take('/api/editor/log/translations')
  h.emit('EDITOR_ITEM_REVIEWED', 'b')
  h.flushTimer()
  full.resolve(page([entry('a', publication), entry('b', publication)]))
  const updated = await h.take('/api/editor/log/translations/b')
  updated.resolve(entry('b', publication, 'reviewed b'))
  await settle()
  assert.equal(h.data.value.entries.find(item => item.id === 'a').publication?.number, 2)
  assert.equal(h.data.value.entries.find(item => item.id === 'b').proposedText, 'reviewed b')
})

test('separate review batches retain both changed entries when responses overlap', async (context) => {
  const h = harness(context)
  h.emit('EDITOR_ITEM_REVIEWED', 'a')
  h.flushTimer()
  const first = await h.take('/api/editor/log/translations/a')
  h.emit('EDITOR_ITEM_REVIEWED', 'b')
  h.flushTimer()
  first.resolve(entry('a', publication, 'reviewed a'))
  const second = await h.take('/api/editor/log/translations/b')
  second.resolve(entry('b', publication, 'reviewed b'))
  await settle()
  assert.equal(h.data.value.entries.find(item => item.id === 'a').proposedText, 'reviewed a')
  assert.equal(h.data.value.entries.find(item => item.id === 'b').proposedText, 'reviewed b')
})
