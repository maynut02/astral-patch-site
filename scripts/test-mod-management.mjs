import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const nuxtRequire = createRequire(import.meta.resolve('nuxt/package.json'))
const { compileScript, compileTemplate, parse } = nuxtRequire('@vue/compiler-sfc')
const vue = nuxtRequire('vue')
const { computed, createSSRApp, effectScope, h, nextTick, onScopeDispose, reactive, ref, watch } = vue
const { renderToString } = nuxtRequire('@vue/server-renderer')
const descriptors = new Map()
for (const file of ['app/components/mod/ModDeleteConfirm.vue', 'app/components/mod/ModDetail.vue', 'app/pages/mod/[id].vue', 'app/pages/mod/index.vue']) {
  const { descriptor, errors } = parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), { filename: file })
  assert.deepEqual(errors, [])
  descriptors.set(file, descriptor)
}

const composableSources = new Map(await Promise.all([
  ['useSessionKey', 'use-session-key'],
  ['useReadySession', 'use-ready-session']
].map(async ([name, file]) => [
  name,
  await readFile(new URL(`../app/composables/${file}.ts`, import.meta.url), 'utf8')
])))

const renderer = vue.createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert() {},
  remove() {},
  setText() {},
  setElementText() {},
  parentNode: () => null,
  nextSibling: () => null,
  patchProp() {}
})

function loadComponent(file, runtime, withTemplate = false) {
  const descriptor = descriptors.get(file)
  const script = compileScript(descriptor, { id: file })
  const composables = {}
  const evaluate = (source) => {
    const componentModule = { exports: {} }
    runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, {
      module: componentModule,
      exports: componentModule.exports,
      computed, ref, reactive, watch, onScopeDispose, AbortController,
      ...runtime,
      ...composables,
      require: (name) => {
        if (name === '~/utils/mod') return {
          MOD_PLATFORM_ITEMS: [{ label: 'Windows', value: 'windows', icon: 'i-tabler-brand-windows' }],
          formatModDate: date => date,
          getModPlatformIcon: () => 'i-tabler-brand-windows',
          getModPlatformLabel: () => 'Windows'
        }
        if (name === '~/utils/request-error') return { getRequestErrorMessage: (_, fallback) => fallback }
        if (name === 'vue' && runtime.withAsyncContext) return { ...vue, withAsyncContext: runtime.withAsyncContext }
        return nuxtRequire(name)
      }
    })
    return componentModule.exports
  }
  for (const [name, source] of composableSources) {
    composables[name] = evaluate(source)[name]
  }
  const component = evaluate(script.content).default
  if (withTemplate) {
    const template = compileTemplate({ source: descriptor.template.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
    component.render = evaluate(template.code).render
  }
  return component
}

function mod(overrides = {}) {
  return {
    id: '1', name: '한글 패치', repository: 'owner/repo', summary: '', description: '', platforms: ['windows'],
    authorHandle: 'owner', authorRole: 'user', isOwner: true, canEdit: true, canDelete: true,
    createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z', ...overrides
  }
}

function session() {
  return { loggedIn: ref(true), user: ref({ id: 'owner-id', role: 'user' }) }
}

function mountConfirm(context, overrides = {}) {
  const viewer = session()
  const initialProps = reactive({ open: false, mod: mod(), ...overrides })
  const requests = []
  const deleted = []
  const scope = effectScope()
  const component = loadComponent('app/components/mod/ModDeleteConfirm.vue', {
    useUserSession: () => viewer,
    $fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }))
  })
  let state
  let props
  const originalSetup = component.setup
  component.setup = (componentProps, context) => {
    props = vue.getCurrentInstance().props
    state = originalSetup(componentProps, context)
    return state
  }
  component.render = () => null
  const app = renderer.createApp(component, {
    ...initialProps,
    'onUpdate:open': (value) => { props.open = value },
    'onDeleted': value => deleted.push(value)
  })
  scope.run(() => app.mount({}))
  const dispose = () => {
    app.unmount()
    scope.stop()
  }
  context.after(dispose)
  return { viewer, props, state, requests, deleted, scope: { stop: dispose } }
}

async function flush() {
  await Promise.resolve()
  await nextTick()
}

test('opening and cancelling confirmation never deletes; confirming uses only the captured ID once', async (context) => {
  const { props, state, requests, deleted } = mountConfirm(context)
  await state.confirmDelete()
  assert.equal(requests.length, 0)
  props.open = true
  assert.equal(state.target.value.name, '한글 패치')
  assert.equal(requests.length, 0)
  state.cancel()
  assert.equal(props.open, false)
  assert.equal(requests.length, 0)
  props.open = true
  const pending = state.confirmDelete()
  await state.confirmDelete()
  state.cancel()
  assert.equal(props.open, true, 'cancel is blocked while deleting')
  assert.equal(state.submitting.value, true)
  assert.equal(requests.length, 1, 'double confirmation cannot send a second request')
  assert.equal(requests[0].url, '/api/mods/1')
  assert.equal(requests[0].options.method, 'DELETE')
  assert.equal(requests[0].options.body, undefined)
  requests[0].resolve({ id: '1', deleted: true })
  await pending
  assert.equal(props.open, false)
  assert.equal(state.submitting.value, false)
  assert.deepEqual(deleted, ['1'])
})

test('a failed deletion stays open with a safe message and retries the same target', async (context) => {
  const { props, state, requests, deleted } = mountConfirm(context, { open: true })
  const pending = state.confirmDelete()
  requests[0].reject(new Error('DELETE https://internal.invalid/secret failed'))
  await pending
  assert.equal(props.open, true)
  assert.equal(state.error.value, '모드를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  assert.equal(state.submitting.value, false)
  assert.deepEqual(deleted, [])
  const retry = state.confirmDelete()
  assert.equal(state.error.value, '')
  assert.equal(requests[1].url, '/api/mods/1')
  requests[1].resolve({ id: '1', deleted: true })
  await retry
  assert.deepEqual(deleted, ['1'])
})

test('a response for a different target is treated as failure', async (context) => {
  const { props, state, requests, deleted } = mountConfirm(context, { open: true })
  const pending = state.confirmDelete()
  requests[0].resolve({ id: '2', deleted: true })
  await pending
  assert.equal(props.open, true)
  assert.ok(state.error.value)
  assert.deepEqual(deleted, [])
})

test('target changes close confirmation, abort its request and ignore late results', async (context) => {
  const { props, state, requests, deleted } = mountConfirm(context, { open: true })
  const pending = state.confirmDelete()
  props.mod = mod({ id: '2', name: '다른 모드' })
  assert.equal(props.open, false)
  assert.equal(requests[0].options.signal.aborted, true)
  props.open = true
  const nextPending = state.confirmDelete()
  requests[0].resolve({ id: '1', deleted: true })
  await pending
  assert.equal(props.open, true)
  assert.equal(state.target.value.id, '2')
  assert.equal(state.submitting.value, true)
  assert.deepEqual(deleted, [])
  assert.equal(requests[1].url, '/api/mods/2')
  requests[1].resolve({ id: '2', deleted: true })
  await nextPending
  assert.deepEqual(deleted, ['2'])
})

test('user, role, login and delete-permission changes invalidate pending confirmation', async (context) => {
  for (const change of [
    ({ viewer }) => { viewer.user.value = { id: 'another-id', role: 'admin' } },
    ({ viewer }) => { viewer.user.value.role = 'admin' },
    ({ viewer }) => { viewer.loggedIn.value = false },
    ({ props }) => { props.mod.canDelete = false }
  ]) {
    const harness = mountConfirm(context, { open: true })
    const pending = harness.state.confirmDelete()
    change(harness)
    assert.equal(harness.props.open, false)
    assert.equal(harness.requests[0].options.signal.aborted, true)
    harness.requests[0].reject(new Error('late failure'))
    await pending
    assert.equal(harness.state.error.value, '')
    assert.deepEqual(harness.deleted, [])
  }
})

test('non-managers and anonymous viewers cannot confirm deletion even when forced open', async (context) => {
  const denied = mountConfirm(context, { open: true, mod: mod({ isOwner: false, canEdit: false, canDelete: false }) })
  assert.equal(denied.props.open, false)
  await denied.state.confirmDelete()
  assert.equal(denied.requests.length, 0)
  const anonymous = mountConfirm(context)
  anonymous.viewer.loggedIn.value = false
  anonymous.props.open = true
  await anonymous.state.confirmDelete()
  assert.equal(anonymous.props.open, false)
  assert.equal(anonymous.requests.length, 0)
})

test('disposing confirmation aborts the transport and ignores a successful late response', async (context) => {
  const { state, requests, deleted, scope } = mountConfirm(context, { open: true })
  const pending = state.confirmDelete()
  scope.stop()
  assert.equal(requests[0].options.signal.aborted, true)
  requests[0].resolve({ id: '1', deleted: true })
  await pending
  assert.deepEqual(deleted, [])
})

function registerUi(app) {
  app.component('UButton', {
    props: ['disabled', 'loading', 'to'],
    render() { return h('button', { disabled: this.disabled || this.loading }, this.$slots.default?.()) }
  })
  app.component('UModal', {
    props: ['open', 'title', 'description', 'dismissible', 'close'],
    render() {
      return h('section', { 'data-dismissible': String(this.dismissible), 'data-close': String(this.close) }, [
        h('h2', this.title), h('p', this.description), this.$slots.body?.(), this.$slots.footer?.()
      ])
    }
  })
  app.component('UAlert', {
    props: ['title'],
    render() {
      return h('p', this.title)
    }
  })
  app.component('UTooltip', {
    render() {
      return h('span', this.$slots.default?.())
    }
  })
  for (const name of ['UIcon', 'UTabs', 'UBadge', 'ReleaseMarkdown', 'ModCommits', 'ModReleases', 'AppUserIdentity']) {
    app.component(name, { render: () => null })
  }
  app.config.warnHandler = warning => assert.fail(warning)
}

test('the real confirmation template names the target and locks dismissal and both buttons during a request', async () => {
  const viewer = session()
  const component = loadComponent('app/components/mod/ModDeleteConfirm.vue', { useUserSession: () => viewer, $fetch: () => new Promise(() => {}) }, true)
  const originalSetup = component.setup
  component.setup = (props, context) => {
    const state = originalSetup(props, context)
    void state.confirmDelete()
    return state
  }
  const app = createSSRApp(component, { open: true, mod: mod() })
  registerUi(app)
  const html = await renderToString(app)
  assert.ok(html.includes('<strong>한글 패치</strong>'))
  assert.ok(html.includes('data-dismissible="false"'))
  assert.ok(html.includes('data-close="false"'))
  assert.equal((html.match(/<button[^>]*disabled/g) ?? []).length, 2)
})

test('the detail header shows manage buttons for owner and admin, but hides them for other and anonymous users', async () => {
  for (const [loggedIn, flags, enabled, expected] of [
    [true, { isOwner: true, canEdit: true, canDelete: true }, true, true],
    [true, { isOwner: false, canEdit: true, canDelete: true }, true, true],
    [true, { isOwner: false, canEdit: false, canDelete: false }, true, false],
    [false, { isOwner: true, canEdit: true, canDelete: true }, true, false],
    [true, { isOwner: true, canEdit: true, canDelete: true }, false, false]
  ]) {
    const component = loadComponent('app/components/mod/ModDetail.vue', { useUserSession: () => ({ loggedIn: ref(loggedIn) }) }, true)
    const app = createSSRApp(component, { detail: { mod: mod(flags), github: null, githubError: null }, refreshing: false, managementEnabled: enabled })
    registerUi(app)
    const html = await renderToString(app)
    assert.equal(html.includes('정보 수정'), expected)
    assert.equal(/<button[^>]*>\s*삭제\s*<\/button>/.test(html), expected)
  }
})

async function mountPage(context, file, list = false) {
  const viewer = session()
  const route = reactive({ params: { id: '1' } })
  const data = ref(list
    ? { mods: [mod({ githubDescription: '내 설명' }), mod({ id: '2', name: '다른 사람 모드', isOwner: false, canEdit: true, canDelete: true, githubDescription: '다른 설명' })] }
    : { mod: mod(), github: null, githubError: null })
  const error = ref(null)
  const effects = []
  const refreshRequests = []
  const scope = effectScope()
  const component = loadComponent(file, {
    useUserSession: () => viewer,
    useRoute: () => route,
    useRouter: () => ({
      push: (to) => {
        effects.push(['navigate', to])
        return Promise.resolve()
      }
    }),
    useAppToast: () => ({ showToast: toast => effects.push(['toast', toast]) }),
    useAstralPageSeo() {},
    useFetch: async () => ({ data, error, status: ref('success'), refresh: () => new Promise(resolve => refreshRequests.push(resolve)) }),
    refreshNuxtData: async key => effects.push(['refresh-list', key]),
    clearNuxtData: key => effects.push(['clear-list', key]),
    navigateTo: async to => effects.push(['navigate', to]),
    watch: (...args) => scope.run(() => watch(...args)),
    withAsyncContext: fn => [fn(), () => {}]
  })
  const state = await scope.run(() => component.setup({}, { expose() {} }))
  context.after(() => scope.stop())
  return { viewer, route, data, error, state, effects, refreshRequests }
}

test('successful detail deletion clears the shared list, shows a toast and navigates back; unrelated IDs do nothing', async (context) => {
  const { state, effects } = await mountPage(context, 'app/pages/mod/[id].vue')
  await state.handleDeleted('2')
  assert.deepEqual(effects, [])
  state.openDelete()
  assert.equal(state.deleteOpen.value, true)
  await state.handleDeleted('1')
  assert.equal(state.deleteOpen.value, false)
  assert.equal(state.managementEnabled.value, false)
  assert.equal(effects[0][0], 'clear-list')
  assert.equal(effects[0][1], 'mod-hub-list')
  assert.equal(effects[1][0], 'toast')
  assert.equal(effects[1][1].title, '모드를 삭제했습니다.')
  assert.equal(effects[2][0], 'navigate')
  assert.equal(effects[2][1], '/mod')
  await state.handleDeleted('1')
  assert.equal(effects.length, 3, 'late duplicate success cannot repeat effects')
})

test('changing route or permission closes both editors and ignores a previous target deletion', async (context) => {
  const { state, route, data, effects } = await mountPage(context, 'app/pages/mod/[id].vue')
  state.openDelete()
  route.params.id = '2'
  assert.equal(state.deleteOpen.value, false)
  await state.handleDeleted('1')
  assert.deepEqual(effects, [])
  data.value = { mod: mod({ id: '2' }), github: null, githubError: null }
  state.openEditor()
  assert.equal(state.editorOpen.value, true)
  data.value.mod.canEdit = false
  assert.equal(state.editorOpen.value, false)
  state.openDelete()
  assert.equal(state.deleteOpen.value, true)
  data.value.mod.canDelete = false
  assert.equal(state.deleteOpen.value, false)
  await state.handleDeleted('2')
  assert.deepEqual(effects, [])
})

test('session changes hide management until refreshed and reject a late save from the previous viewer', async (context) => {
  const { viewer, state, effects, refreshRequests } = await mountPage(context, 'app/pages/mod/[id].vue')
  state.openEditor()
  viewer.user.value = { id: 'admin-id', role: 'admin' }
  assert.equal(state.editorOpen.value, false)
  assert.equal(state.deleteOpen.value, false)
  assert.equal(state.managementEnabled.value, false)
  await state.handleSaved(mod({ name: 'stale response' }))
  assert.deepEqual(effects, [])
  state.openDelete()
  assert.equal(state.deleteOpen.value, false)
  refreshRequests[0]()
  await flush()
  assert.equal(state.managementEnabled.value, true)
  state.openDelete()
  assert.equal(state.deleteOpen.value, true)
})

test('an admin my-mods filter uses registration ownership while still showing all mods normally', async (context) => {
  const { viewer, state } = await mountPage(context, 'app/pages/mod/index.vue', true)
  viewer.user.value.role = 'admin'
  assert.equal(state.filteredMods.value.length, 2)
  state.onlyMine.value = true
  assert.equal(state.filteredMods.value.length, 1)
  assert.equal(state.filteredMods.value[0].id, '1')
  state.search.value = '다른 설명'
  assert.equal(state.filteredMods.value.length, 0)
  state.onlyMine.value = false
  assert.equal(state.filteredMods.value[0].id, '2', 'About search remains intact')
})
