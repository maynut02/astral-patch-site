import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const nuxtRequire = createRequire(import.meta.resolve('nuxt/package.json'))
const { compileScript, parse } = nuxtRequire('@vue/compiler-sfc')
const { computed, createSSRApp, effectScope, h, nextTick, onScopeDispose, reactive, ref, watch } = nuxtRequire('vue')
const { renderToString } = nuxtRequire('@vue/server-renderer')
const source = await readFile(new URL('../app/components/mod/ModCommits.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source, { filename: 'ModCommits.vue' })
assert.deepEqual(errors, [])

function loadComponent(fetch, inlineTemplate = false) {
  const compiled = compileScript(descriptor, { id: 'mod-commits', inlineTemplate })
  const { outputText } = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const componentModule = { exports: {} }
  runInNewContext(outputText, {
    module: componentModule,
    exports: componentModule.exports,
    computed,
    ref,
    watch,
    onScopeDispose,
    AbortController,
    $fetch: fetch,
    require: name => name === '~/utils/mod'
      ? { formatModDate: date => date }
      : nuxtRequire(name)
  })
  return componentModule.exports.default
}

function commit(branch) {
  return { sha: `${branch}-sha`, message: `${branch} 변경\n상세 내용`, author: '개발자', date: '2026-10-07T00:00:00Z', url: `https://github.com/owner/repo/commit/${branch}-sha` }
}

function defaultProps(overrides = {}) {
  return { modId: '1', repository: 'owner/repo', defaultBranch: 'main', branches: ['main', 'develop', 'feature/한글'], commits: [commit('main')], ...overrides }
}

function mount(context, overrides = {}) {
  const requests = []
  const component = loadComponent((url, options) => new Promise((resolve, reject) => {
    requests.push({ url, options, resolve, reject })
  }))
  const props = reactive(defaultProps(overrides))
  const scope = effectScope()
  const state = scope.run(() => component.setup(props, { expose() {} }))
  context.after(() => scope.stop())
  return { props, state, requests, scope }
}

async function flush() {
  await Promise.resolve()
  await nextTick()
}

test('initial default-branch snapshot needs no request; branch and Unicode URL are encoded separately', async (context) => {
  const { state, requests } = mount(context)
  assert.equal(state.selectedBranch.value, 'main')
  assert.equal(state.entries.value[0].sha, 'main-sha')
  assert.equal(requests.length, 0)
  state.selectedBranch.value = 'feature/한글'
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/mods/1/commits')
  assert.equal(requests[0].options.query.branch, 'feature/한글')
  assert.equal(state.allCommitsUrl.value, 'https://github.com/owner/repo/commits/feature%2F%ED%95%9C%EA%B8%80/')
  assert.equal(state.entries.value.length, 0, 'old branch commits disappear while loading')
  assert.equal(state.loading.value, true)
  requests[0].resolve({ branch: 'feature/한글', commits: [commit('feature')] })
  await flush()
  assert.equal(state.entries.value[0].sha, 'feature-sha')
  assert.equal(state.loading.value, false)
})

test('rapid switches ignore late success and failure responses even if transport ignores abort', async (context) => {
  const { state, requests } = mount(context)
  state.selectedBranch.value = 'develop'
  state.selectedBranch.value = 'feature/한글'
  assert.equal(requests[0].options.signal.aborted, true)
  requests[0].resolve({ branch: 'develop', commits: [commit('develop')] })
  await flush()
  assert.equal(state.entries.value.length, 0)
  assert.equal(state.loading.value, true)
  requests[1].resolve({ branch: 'feature/한글', commits: [commit('feature')] })
  await flush()
  assert.equal(state.entries.value[0].sha, 'feature-sha')
  state.selectedBranch.value = 'develop'
  state.selectedBranch.value = 'main'
  assert.equal(state.entries.value[0].sha, 'main-sha')
  requests[2].reject(new Error('late failure'))
  await flush()
  assert.equal(state.error.value, '')
  assert.equal(state.entries.value[0].sha, 'main-sha')
  assert.equal(state.loading.value, false)
})

test('a loaded branch is reused until the detail snapshot refreshes', async (context) => {
  const { state, requests, props } = mount(context)
  state.selectedBranch.value = 'develop'
  requests[0].resolve({ branch: 'develop', commits: [commit('develop')] })
  await flush()
  state.selectedBranch.value = 'main'
  state.selectedBranch.value = 'develop'
  assert.equal(requests.length, 1)
  assert.equal(state.entries.value[0].sha, 'develop-sha')
  props.commits = [commit('new-main')]
  await flush()
  assert.equal(state.selectedBranch.value, 'develop', 'refresh preserves a still-available branch')
  assert.equal(requests.length, 2, 'refresh clears the selected branch cache')
  assert.equal(state.entries.value.length, 0)
  requests[1].resolve({ branch: 'develop', commits: [commit('new-develop')] })
  await flush()
  assert.equal(state.entries.value[0].sha, 'new-develop-sha')
  state.selectedBranch.value = 'main'
  assert.equal(state.entries.value[0].sha, 'new-main-sha')
})

test('failed branch loads show a safe message and retry only the selected branch', async (context) => {
  const { state, requests } = mount(context)
  state.selectedBranch.value = 'develop'
  requests[0].reject(new Error('https://internal.invalid/secret'))
  await flush()
  assert.equal(state.error.value, '선택한 브랜치의 커밋을 불러오지 못했습니다.')
  assert.equal(state.entries.value.length, 0)
  assert.equal(state.loading.value, false)
  const retry = state.loadBranch(state.selectedBranch.value, true)
  assert.equal(requests[1].options.query.branch, 'develop')
  assert.equal(state.error.value, '')
  assert.equal(state.loading.value, true)
  requests[1].resolve({ branch: 'develop', commits: [] })
  await retry
  assert.equal(state.error.value, '')
  assert.equal(state.entries.value.length, 0)
  assert.equal(state.loading.value, false)
})

test('an API response for a different branch never becomes the displayed commit list', async (context) => {
  const { state, requests } = mount(context)
  state.selectedBranch.value = 'develop'
  requests[0].resolve({ branch: 'main', commits: [commit('wrong-main')] })
  await flush()
  assert.equal(state.entries.value.length, 0)
  assert.equal(state.error.value, '선택한 브랜치의 커밋을 불러오지 못했습니다.')
})

test('repository changes reset selection, cache and pending requests', async (context) => {
  const { state, requests, props } = mount(context)
  state.selectedBranch.value = 'develop'
  Object.assign(props, { repository: 'owner/other', commits: [commit('other-main')] })
  await flush()
  assert.equal(requests[0].options.signal.aborted, true)
  assert.equal(state.selectedBranch.value, 'main')
  assert.equal(state.entries.value[0].sha, 'other-main-sha')
  assert.equal(state.allCommitsUrl.value, 'https://github.com/owner/other/commits/main/')
  requests[0].resolve({ branch: 'develop', commits: [commit('old-develop')] })
  await flush()
  assert.equal(state.entries.value[0].sha, 'other-main-sha')
  state.selectedBranch.value = 'develop'
  assert.equal(requests.length, 2, 'previous repository results were not cached')
})

test('changing mod ID resets to the new snapshot and requests the new mod endpoint', async (context) => {
  const { state, requests, props } = mount(context)
  state.selectedBranch.value = 'develop'
  Object.assign(props, { modId: '2', commits: [commit('second-main')] })
  await flush()
  assert.equal(state.selectedBranch.value, 'main')
  assert.equal(state.entries.value[0].sha, 'second-main-sha')
  state.selectedBranch.value = 'develop'
  assert.equal(requests[1].url, '/api/mods/2/commits')
})

test('a removed selected branch falls back to the default snapshot without another request', async (context) => {
  const { state, requests, props } = mount(context)
  state.selectedBranch.value = 'develop'
  requests[0].resolve({ branch: 'develop', commits: [commit('develop')] })
  await flush()
  props.branches = ['main']
  await flush()
  assert.equal(state.selectedBranch.value, 'main')
  assert.equal(state.entries.value[0].sha, 'main-sha')
  assert.equal(requests.length, 1)
})

test('disposing the component aborts and ignores pending requests', async (context) => {
  const { state, requests, scope } = mount(context)
  state.selectedBranch.value = 'develop'
  scope.stop()
  assert.equal(requests[0].options.signal.aborted, true)
  requests[0].resolve({ branch: 'develop', commits: [commit('late-develop')] })
  await flush()
  assert.equal(state.entries.value.length, 0)
})

test('real template shows a selector only for multiple branches and no recent-commits label', async () => {
  for (const branches of [['main'], ['main', 'develop']]) {
    const app = createSSRApp(loadComponent(() => assert.fail('initial render must use the snapshot'), true), defaultProps({ branches }))
    app.component('USelect', {
      props: ['modelValue', 'items'],
      render() {
        return h('select', {}, this.items.map(branch => h('option', { value: branch }, branch)))
      }
    })
    app.component('UButton', {
      props: ['to'],
      render() {
        return h('a', { href: this.to }, this.$slots.default?.())
      }
    })
    app.component('UIcon', { render: () => null })
    app.config.warnHandler = warning => assert.fail(warning)
    const html = await renderToString(app)
    assert.equal(html.includes('<select'), branches.length > 1)
    assert.ok(!html.includes('최근 커밋'))
    assert.ok(html.includes('href="https://github.com/owner/repo/commits/main/"'))
    assert.ok(html.includes('main 변경'))
  }
})
