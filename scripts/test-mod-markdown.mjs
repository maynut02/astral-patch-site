import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { parseReleaseMarkdown, parseReleaseMarkdownInline } from '../app/utils/release-markdown.ts'

// Use Nuxt's installed Vue packages to compile and render the real components.
const nuxtRequire = createRequire(import.meta.resolve('nuxt/package.json'))
const { compileScript, parse } = nuxtRequire('@vue/compiler-sfc')
const { computed, createSSRApp } = nuxtRequire('vue')
const { renderToString } = nuxtRequire('@vue/server-renderer')

async function loadComponent(filename) {
  const source = await readFile(new URL(`../app/components/${filename}`, import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  const compiled = compileScript(descriptor, { id: filename, inlineTemplate: true })
  const { outputText } = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const componentModule = { exports: {} }
  runInNewContext(outputText, {
    module: componentModule,
    exports: componentModule.exports,
    computed,
    require: name => name === '~/utils/release-markdown'
      ? { parseReleaseMarkdown, parseReleaseMarkdownInline }
      : nuxtRequire(name)
  })
  return componentModule.exports.default
}

const ReleaseMarkdownInline = await loadComponent('ReleaseMarkdownInline.vue')
const ReleaseMarkdown = await loadComponent('ReleaseMarkdown.vue')

async function renderRelease(source, baseUrl, imageBaseUrl) {
  const app = createSSRApp(ReleaseMarkdown, { source, baseUrl, imageBaseUrl })
  app.component('ReleaseMarkdownInline', ReleaseMarkdownInline)
  app.component('UIcon', { render: () => null })
  app.config.warnHandler = warning => assert.fail(warning)
  return (await renderToString(app)).replace(/<!--[\s\S]*?-->/g, '')
}

async function assertLinkedImage(source, baseUrl, imageBaseUrl, { href, src, alt }) {
  const expected = [{ type: 'link', href, children: [{ type: 'image', src, alt }] }]
  assert.deepEqual(parseReleaseMarkdownInline(source, baseUrl, imageBaseUrl), expected)
  assert.deepEqual(parseReleaseMarkdown(source, baseUrl, imageBaseUrl), [{ type: 'paragraph', children: expected }])
  const html = await renderRelease(source, baseUrl, imageBaseUrl)
  assert.equal((html.match(/<a\b/g) ?? []).length, 1)
  assert.equal((html.match(/<img\b/g) ?? []).length, 1)
  assert.match(html, /<a\b[^>]*><img\b[^>]*><\/a>/)
  assert.ok(html.includes(`href="${href.replaceAll('&', '&amp;')}"`))
  assert.ok(html.includes(`src="${src.replaceAll('&', '&amp;')}"`))
  assert.ok(html.includes(`alt="${alt}"`))
  assert.match(html, /target="_blank" rel="noopener noreferrer"/)
}

function assertNoNestedLinks(nodes, insideLink = false) {
  for (const node of nodes) {
    assert.ok(!(insideLink && node.type === 'link'), 'a link label must not contain another anchor')
    if ('children' in node) assertNoNestedLinks(node.children, insideLink || node.type === 'link')
  }
}

const battleLogReadmeUrl = 'https://github.com/YoungHoon02/astral-party-battle-log/blob/main/README.md'
const battleLogImageBaseUrl = 'https://raw.githubusercontent.com/YoungHoon02/astral-party-battle-log/main/'
const battleLogReleasesUrl = 'https://github.com/YoungHoon02/astral-party-battle-log/releases'
const latestReleaseBadgeUrl = 'https://img.shields.io/github/v/release/YoungHoon02/astral-party-battle-log?sort=semver&style=for-the-badge&logo=github&label=download'

test('battle-log README release badge parses and renders as a linked image without trailing Markdown', async () => {
  await assertLinkedImage(`[![Latest release](${latestReleaseBadgeUrl})](../../releases)`,
    battleLogReadmeUrl, battleLogImageBaseUrl, {
      href: battleLogReleasesUrl, src: latestReleaseBadgeUrl, alt: 'Latest release'
    })
})

test('release linked images preserve balanced parentheses in both destinations', async () => {
  await assertLinkedImage('[![다운로드](https://example.com/badges/v(2).svg)](../v(2))',
    releaseBaseUrl, undefined, {
      href: 'https://github.com/maynut02/astral-party-korean-plugin/releases/tag/v(2)',
      src: 'https://example.com/badges/v(2).svg', alt: '다운로드'
    })
})

test('linked relative images resolve against the image base while links use the README base', async () => {
  await assertLinkedImage('[![설치 화면](images/install(v2).png)](docs/install(v2).md)',
    battleLogReadmeUrl, battleLogImageBaseUrl, {
      href: 'https://github.com/YoungHoon02/astral-party-battle-log/blob/main/docs/install(v2).md',
      src: `${battleLogImageBaseUrl}images/install(v2).png`, alt: '설치 화면'
    })
})

test('escaped brackets and code containing brackets do not prematurely close a linked image label', async () => {
  const source = '[설치 \\[안내\\] `문자 ] [ ![가짜](images/fake.png)` ![실제 [배지]](images/badge.png)](../../releases)'
  assert.deepEqual(parseReleaseMarkdownInline(source, battleLogReadmeUrl, battleLogImageBaseUrl), [{
    type: 'link', href: battleLogReleasesUrl, children: [
      { type: 'text', text: '설치 [안내] ' },
      { type: 'code', text: '문자 ] [ ![가짜](images/fake.png)' },
      { type: 'text', text: ' ' },
      { type: 'image', src: `${battleLogImageBaseUrl}images/badge.png`, alt: '실제 [배지]' }
    ]
  }])
  const html = await renderRelease(source, battleLogReadmeUrl, battleLogImageBaseUrl)
  assert.equal((html.match(/<a\b/g) ?? []).length, 1)
  assert.equal((html.match(/<img\b/g) ?? []).length, 1)
  assert.match(html, /<code[^>]*>문자 ] \[ !\[가짜\]\(images\/fake\.png\)<\/code>/)
  assert.ok(html.includes(`src="${battleLogImageBaseUrl}images/badge.png"`))
  assert.ok(!html.includes(`src="${battleLogImageBaseUrl}images/fake.png"`))
})

test('escaped image openers and code spans never produce an image', async () => {
  for (const source of [
    '\\![배지](images/badge.png)',
    '!\\[배지](images/badge.png)',
    '`[![배지](images/badge.png)](../../releases)`',
    '[\\![배지](images/badge.png)](../../releases)'
  ]) {
    const nodes = parseReleaseMarkdownInline(source, battleLogReadmeUrl, battleLogImageBaseUrl)
    assertNoNestedLinks(nodes)
    const html = await renderRelease(source, battleLogReadmeUrl, battleLogImageBaseUrl)
    assert.ok(!html.includes('<img'), source)
  }
})

test('nested Markdown links and autolinks in an image link label never produce nested anchors', async () => {
  const source = '[https://example.com **[문서](https://example.com/docs)** <https://example.com/help> ![배지](images/badge.png)](../../releases)'
  const nodes = parseReleaseMarkdownInline(source, battleLogReadmeUrl, battleLogImageBaseUrl)
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].type, 'link')
  assert.equal(nodes[0].href, battleLogReleasesUrl)
  assertNoNestedLinks(nodes)
  const html = await renderRelease(source, battleLogReadmeUrl, battleLogImageBaseUrl)
  assert.equal((html.match(/<a\b/g) ?? []).length, 1)
  assert.equal((html.match(/<img\b/g) ?? []).length, 1)
  assert.ok(html.includes(`href="${battleLogReleasesUrl}"`))
})

test('linked images keep forbidden image and link protocols inactive', async () => {
  for (const src of ['javascript:alert(1)', 'data:image/svg+xml,unsafe', 'mailto:test@example.com']) {
    const source = `[![배지](${src})](../../releases)`
    const nodes = parseReleaseMarkdownInline(source, battleLogReadmeUrl, battleLogImageBaseUrl)
    assertNoNestedLinks(nodes)
    const html = await renderRelease(source, battleLogReadmeUrl, battleLogImageBaseUrl)
    assert.ok(!html.includes('<img'), src)
    assert.doesNotMatch(html, /(?:href|src)="(?:javascript|data):/i)
  }
  for (const href of ['javascript:alert(1)', 'data:text/html,unsafe', 'vbscript:msgbox(1)']) {
    const source = `[![Latest release](${latestReleaseBadgeUrl})](${href})`
    const nodes = parseReleaseMarkdownInline(source, battleLogReadmeUrl, battleLogImageBaseUrl)
    assertNoNestedLinks(nodes)
    const html = await renderRelease(source, battleLogReadmeUrl, battleLogImageBaseUrl)
    assert.ok(!html.includes('<a '), href)
    assert.doesNotMatch(html, /(?:href|src)="(?:javascript|data|vbscript):/i)
  }
})

test('malformed image delimiters never create images or nested anchors', async () => {
  for (const source of [
    '![배지](images/badge.png',
    '[![배지](images/badge.png](docs/install)',
    '[![배지](images/badge(v2.png)](docs/install)',
    '[[![배지](images/badge.png]](docs/install)'
  ]) {
    const nodes = parseReleaseMarkdownInline(source, battleLogReadmeUrl, battleLogImageBaseUrl)
    assertNoNestedLinks(nodes)
    const html = await renderRelease(source, battleLogReadmeUrl, battleLogImageBaseUrl)
    assert.ok(!html.includes('<img'), source)
    assert.doesNotMatch(html, /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/, source)
  }
})

const releaseBaseUrl = 'https://github.com/maynut02/astral-party-korean-plugin/releases/tag/v2.0.0/'
const commitBaseUrl = 'https://github.com/maynut02/astral-party-korean-plugin/commit/'
const commitHref = `${commitBaseUrl}119a4aa46d6209031e82a46d91b113ad6cb92eb4`

// Public v2.0.0 release body retrieved on 2026-10-07: these hashes have no Markdown links.
// https://github.com/maynut02/astral-party-korean-plugin/releases/tag/v2.0.0
const releaseChanges = `## 변경 사항

- feat: 한글패치 플러그인 저장소 분리 (119a4aa)
- refactor: 한글패치 플러그인 빌드 구조와 미사용 코드 정리 (8328c48)
- docs: 한글패치 플러그인 문서 구성과 안내 재작성 (f1fc042)
- fix: 로컬 SDK 준비와 버전별 릴리즈 패키징 개선 (6f03c64)`

test('explicit commit Markdown links parse and render with their surrounding parentheses', async () => {
  const source = `feat: 한글패치 플러그인 저장소 분리 ([119a4aa](${commitHref}))`
  for (const baseUrl of [undefined, releaseBaseUrl]) {
    assert.deepEqual(parseReleaseMarkdownInline(source, baseUrl), [
      { type: 'text', text: 'feat: 한글패치 플러그인 저장소 분리 (' },
      { type: 'link', href: commitHref, children: [{ type: 'text', text: '119a4aa' }] },
      { type: 'text', text: ')' }
    ])
    const html = await renderRelease(source, baseUrl)
    assert.match(html, new RegExp(`\\(<a href="${commitHref}"[^>]*>119a4aa</a>\\)`))
    assert.match(html, /target="_blank" rel="noopener noreferrer"/)
  }
})

test('actual GitHub release body renders parenthesized commit hashes as links', async () => {
  const blocks = parseReleaseMarkdown(releaseChanges, releaseBaseUrl)
  assert.equal(blocks[0].type, 'heading')
  assert.equal(blocks[1].type, 'list')
  const hashes = ['119a4aa', '8328c48', 'f1fc042', '6f03c64']
  for (const [index, hash] of hashes.entries()) {
    assert.deepEqual(blocks[1].items[index].children.find(node => node.type === 'link'), {
      type: 'link', href: `${commitBaseUrl}${hash}`, children: [{ type: 'text', text: hash }]
    })
  }
  const html = await renderRelease(releaseChanges, releaseBaseUrl)
  assert.equal((html.match(/<a /g) ?? []).length, hashes.length)
  for (const hash of hashes) {
    assert.ok(html.includes(`href="${commitBaseUrl}${hash}"`))
    assert.match(html, new RegExp(`\\(<a [^>]*>${hash}</a>\\)`), 'hash parentheses are preserved outside the link')
  }
})

test('commit shorthand is limited to parenthesized hashes in a GitHub release context', () => {
  const source = '(119a4aa)'
  for (const baseUrl of [
    undefined,
    'https://github.com/maynut02/astral-party-korean-plugin/blob/main/README.md',
    'https://example.com/maynut02/astral-party-korean-plugin/releases/tag/v2.0.0/',
    'https://github.com.example.com/maynut02/astral-party-korean-plugin/releases/tag/v2.0.0/',
    'javascript:alert',
    'data:text/html,unsafe'
  ]) {
    assert.deepEqual(parseReleaseMarkdownInline(source, baseUrl), [{ type: 'text', text: source }])
  }
  for (const text of ['119a4aa', '(119a4a)', `(${'a'.repeat(41)})`, '(119a4ag)', '\\(119a4aa)']) {
    assert.ok(parseReleaseMarkdownInline(text, releaseBaseUrl).every(node => node.type === 'text'))
  }
})

test('commit shorthand preserves formatting without creating nested links', async () => {
  const html = await renderRelease('**feat (119a4aa)** [이동 *(119a4aa)*](https://github.com/owner/repo)', releaseBaseUrl)
  assert.equal((html.match(/<a /g) ?? []).length, 2)
  assert.match(html, /<strong[^>]*>feat \(<a [^>]*>119a4aa<\/a>\)<\/strong>/)
  assert.match(html, /href="https:\/\/github.com\/owner\/repo"[^>]*>이동 <em[^>]*>\(119a4aa\)<\/em><\/a>/)
})

test('commit shorthand leaves inline and fenced code literal', async () => {
  const source = '`(119a4aa)`\n\n```md\n(119a4aa)\n```'
  const blocks = parseReleaseMarkdown(source, releaseBaseUrl)
  assert.deepEqual(blocks[0].children, [{ type: 'code', text: '(119a4aa)' }])
  assert.equal(blocks[1].text, '(119a4aa)')
  const html = await renderRelease(source, releaseBaseUrl)
  assert.ok(!html.includes('<a '))
  assert.match(html, /<code[^>]*>\(119a4aa\)<\/code>/)
})

test('ordinary links still render and dangerous protocols never become anchors or images', async () => {
  const html = await renderRelease('[설치](docs/install.md) [메일](mailto:test@example.com) [링크](javascript:alert) ![그림](data:text/html,unsafe)', releaseBaseUrl)
  assert.ok(html.includes(`href="${releaseBaseUrl}docs/install.md"`))
  assert.ok(html.includes('href="mailto:test@example.com"'))
  assert.equal((html.match(/<a /g) ?? []).length, 2)
  assert.ok(!html.includes('<img'))
  assert.ok(html.includes('[링크](javascript:alert) ![그림](data:text/html,unsafe)'))
})

test('README relative links and images resolve against their own GitHub bases', () => {
  const nodes = parseReleaseMarkdownInline('[설치](docs/install.md) ![화면](images/screen.png)',
    'https://github.com/owner/repo/blob/main/README.md',
    'https://raw.githubusercontent.com/owner/repo/main/')
  assert.equal(nodes.find(node => node.type === 'link').href, 'https://github.com/owner/repo/blob/main/docs/install.md')
  assert.deepEqual(nodes.find(node => node.type === 'image'), {
    type: 'image', alt: '화면', src: 'https://raw.githubusercontent.com/owner/repo/main/images/screen.png'
  })
})

test('unsafe links and image protocols remain plain text', () => {
  const nodes = parseReleaseMarkdownInline('[링크](javascript:alert) ![그림](data:text/html,unsafe) ![메일](mailto:test@example.com)', 'https://github.com/owner/repo/blob/main/README.md')
  assert.ok(nodes.every(node => node.type === 'text'))
})

test('inline and fenced code are not rewritten as links or images', () => {
  const blocks = parseReleaseMarkdown('`[문서](docs/a.md)`\n\n```md\n![그림](image.png)\n```', 'https://github.com/owner/repo/blob/main/README.md')
  assert.deepEqual(blocks[0].children, [{ type: 'code', text: '[문서](docs/a.md)' }])
  assert.equal(blocks[1].text, '![그림](image.png)')
})

test('existing release headings, tables and formatting still parse without a base URL', () => {
  const blocks = parseReleaseMarkdown('# 업데이트\n\n| 항목 | 값 |\n| --- | --- |\n| **버전** | [보기](https://github.com/owner/repo/releases) |')
  assert.equal(blocks[0].type, 'heading')
  assert.equal(blocks[1].type, 'table')
  assert.equal(blocks[1].rows[0][0][0].type, 'strong')
  assert.equal(blocks[1].rows[0][1][0].href, 'https://github.com/owner/repo/releases')
})
