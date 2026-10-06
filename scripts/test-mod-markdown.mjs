import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseReleaseMarkdown, parseReleaseMarkdownInline } from '../app/utils/release-markdown.ts'

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
