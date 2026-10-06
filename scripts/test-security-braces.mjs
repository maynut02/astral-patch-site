import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Guard design: https://github.com/micromatch/braces/pull/78
// Source revision: 97308a01d091b211cf015314a2d0696da28a5392
// Container-only counting and root handling follow PR #72 at
// 28d440b5dd449dbf1fe6f3506cf94ecca4d02660; stringify parent behavior is retained.
// The local patch changes no package name/version and claims no audit clearance.
// Run unchanged before and after pnpm applies patches/braces@3.0.3.patch:
// node scripts/test-security-braces.mjs

const scriptPath = fileURLToPath(import.meta.url)
const projectRequire = createRequire(import.meta.url)
const nuxtRequire = createRequire(projectRequire.resolve('nuxt/package.json'))
const nitroServerRequire = createRequire(nuxtRequire.resolve('@nuxt/nitro-server/package.json'))
const nitroRequire = createRequire(nitroServerRequire.resolve('nitropack/package.json'))
const globbyRequire = createRequire(nitroRequire.resolve('globby'))
const micromatchPath = globbyRequire.resolve('micromatch')
const micromatchRequire = createRequire(micromatchPath)
const bracesPath = micromatchRequire.resolve('braces')
const braces = micromatchRequire('braces')
const micromatch = globbyRequire('micromatch')
const operations = ['parse', 'compile', 'expand', 'stringify', 'default']
const walkers = ['compile', 'expand', 'stringify']

function nestedPattern(depth, kind = 'brace', content = 'x') {
  const open = kind === 'paren' ? '(' : '{'
  const close = kind === 'paren' ? ')' : '}'
  return open.repeat(depth) + content + close.repeat(depth)
}

function mixedPattern(depth, content = 'x') {
  const opens = Array.from({ length: depth }, (_, i) => i % 2 === 0 ? '{' : '(')
  return opens.join('') + content + opens.reverse().map(c => c === '{' ? '}' : ')').join('')
}

function nestedAst(depth) {
  let ast = { type: 'root', nodes: [] }
  for (let i = 0; i < depth; i++) ast = { type: 'root', nodes: [ast] }
  return ast
}

function runOperation(operation, input, options = {}) {
  return operation === 'default' ? braces(input, options) : braces[operation](input, options)
}

function isDepthError(error) {
  return error instanceof SyntaxError && error.message === 'Nesting depth exceeds the maximum of 100'
}

// Adversarial probes run in fresh processes with a deadline, so a regression
// cannot hang the full CI job. Each process resolves the installed dependency.
if (process.argv[2] === '--probe') {
  const [, , , operation, kind, optionMode] = process.argv
  const input = kind === 'ast' ? nestedAst(4500) : nestedPattern(4500)
  const options = optionMode === 'infinity' ? { maxDepth: Infinity } : {}
  try {
    runOperation(operation, input, options)
    process.stdout.write(JSON.stringify({ accepted: true }))
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.name, message: error.message }))
  }
} else {
  console.log(`Installed micromatch: ${micromatchPath}`)
  console.log(`Installed braces: ${bracesPath}`)

  function probe(operation, kind, optionMode = 'default', smallStack = false) {
    const args = [scriptPath, '--probe', operation, kind, optionMode]
    if (smallStack) args.unshift('--stack_size=512')
    const output = execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 5000 })
    return JSON.parse(output)
  }

  function assertProbeRejected(result) {
    assert.deepEqual(result, {
      error: 'SyntaxError',
      message: 'Nesting depth exceeds the maximum of 100'
    })
  }

  test('uses original braces 3.0.3 through the real Nuxt/Nitro/globby/micromatch dependency chain', () => {
    const metadata = micromatchRequire('braces/package.json')
    assert.equal(metadata.name, 'braces')
    assert.equal(metadata.version, '3.0.3')
    assert.equal(micromatchRequire('braces'), braces)
    assert.equal(typeof micromatch.braces, 'function')
  })

  for (const operation of operations) {
    test(`${operation}: rejects a 9001-character, 4500-level string before stack exhaustion`, () => {
      assert.equal(nestedPattern(4500).length, 9001)
      assertProbeRejected(probe(operation, 'string'))
    })

    test(`${operation}: a 512KB stack still produces the controlled depth error`, () => {
      assertProbeRejected(probe(operation, 'string', 'default', true))
    })

    test(`${operation}: maxDepth Infinity cannot bypass the mandatory string bound`, () => {
      assertProbeRejected(probe(operation, 'string', 'infinity'))
    })

    for (const kind of ['brace', 'paren', 'mixed']) {
      test(`${operation}: ${kind} depth100 is allowed and depth101 is rejected`, () => {
        const pattern = depth => kind === 'mixed' ? mixedPattern(depth) : nestedPattern(depth, kind)
        assert.doesNotThrow(() => runOperation(operation, pattern(100)))
        assert.throws(() => runOperation(operation, pattern(101)), isDepthError)
        assert.throws(() => runOperation(operation, pattern(101), { maxDepth: Infinity }), isDepthError)
      })
    }
  }

  for (const operation of walkers) {
    test(`${operation}: direct 4500-level ASTs cannot bypass parsing guards`, () => {
      assertProbeRejected(probe(operation, 'ast'))
    })

    test(`${operation}: maxDepth Infinity cannot bypass the direct AST bound`, () => {
      assertProbeRejected(probe(operation, 'ast', 'infinity'))
    })

    test(`${operation}: direct AST depth100 is allowed and depth101 is rejected`, () => {
      assert.deepEqual(runOperation(operation, nestedAst(100)), operation === 'expand' ? [] : '')
      assert.throws(() => runOperation(operation, nestedAst(101)), isDepthError)
    })

    test(`${operation}: direct cyclic nodes are stopped by the traversal guard`, () => {
      const ast = { type: 'root', nodes: [] }
      ast.nodes.push(ast)
      assert.throws(() => runOperation(operation, ast), isDepthError)
    })
  }

  const ignoredContainers = [
    ['escaped braces and parentheses', String.raw`\{\(`.repeat(150) + 'x' + String.raw`\)\}`.repeat(150)],
    ['double quotes', '"' + mixedPattern(150) + '"'],
    ['single quotes', '\'' + mixedPattern(150) + '\''],
    ['backtick quotes', '`' + mixedPattern(150) + '`'],
    ['bracket literals', '[' + mixedPattern(150) + ']']
  ]
  for (const [label, literal] of ignoredContainers) {
    test(`${label} do not consume container depth inside 100 real containers`, () => {
      const pattern = mixedPattern(100, literal)
      for (const operation of operations) {
        assert.doesNotThrow(() => runOperation(operation, pattern, { keepQuotes: true, keepEscaping: true }))
      }
      assert.equal(braces.stringify(pattern, { keepQuotes: true, keepEscaping: true }), pattern)
    })
  }

  const ordinaryPatterns = [
    ['src/{app,lib}/**/*.{js,mjs}', 'src/(app|lib)/**/*.(js|mjs)', [
      'src/app/**/*.js', 'src/app/**/*.mjs', 'src/lib/**/*.js', 'src/lib/**/*.mjs'
    ]],
    ['a/{b,{c,d}}/e', 'a/(b|(c|d))/e', ['a/b/e', 'a/c/e', 'a/d/e']],
    ['{a,b}{1,2}', '(a|b)(1|2)', ['a1', 'a2', 'b1', 'b2']],
    ['a\\{b,c\\}', 'a{b,c}', ['a{b,c}']]
  ]
  for (const [pattern, compiled, expanded] of ordinaryPatterns) {
    test(`ordinary compilation, expansion and parsed ASTs retain output: ${pattern}`, () => {
      assert.equal(braces.compile(pattern), compiled)
      assert.deepEqual(braces.expand(pattern), expanded)
      assert.equal(braces.compile(braces.parse(pattern)), compiled)
      assert.deepEqual(braces.expand(braces.parse(pattern)), expanded)
      assert.deepEqual(braces(pattern), [compiled])
    })
  }

  test('numeric ranges, steps, duplicate removal and quoted literals retain output', () => {
    assert.deepEqual(braces.expand('file-{1..3}.js'), ['file-1.js', 'file-2.js', 'file-3.js'])
    assert.deepEqual(braces.expand('n-{1..5..2}'), ['n-1', 'n-3', 'n-5'])
    assert.deepEqual(braces(['{a,a}', '{a,b}'], { expand: true, nodupes: true }), ['a', 'b'])
    assert.equal(braces.compile('"{a,b}"', { keepQuotes: true }), '"{a,b}"')
    assert.deepEqual(braces.expand('"{a,b}"', { keepQuotes: true }), ['"{a,b}"'])
  })

  test('the installed micromatch brace APIs enforce the same guard', () => {
    const pattern = nestedPattern(4500)
    assert.throws(() => micromatch.braces(pattern), isDepthError)
    assert.throws(() => micromatch.braceExpand(pattern), isDepthError)
    assert.throws(() => micromatch.braces(pattern, { maxDepth: Infinity }), isDepthError)
  })

  test('the installed micromatch retains ordinary matching and expansion', () => {
    assert.deepEqual(micromatch.braces('a/{b,c}/d'), ['a/(b|c)/d'])
    assert.deepEqual(micromatch.braceExpand('file-{1..3}.js'), ['file-1.js', 'file-2.js', 'file-3.js'])
    const files = ['src/app/a.js', 'src/lib/b.mjs', 'src/other/a.js', 'README.md']
    assert.deepEqual(micromatch(files, 'src/{app,lib}/**/*.{js,mjs}'), ['src/app/a.js', 'src/lib/b.mjs'])
  })
}
