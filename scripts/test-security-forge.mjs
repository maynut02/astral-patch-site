import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, verify, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Backport: https://github.com/digitalbazaar/forge/pull/1152
// Pinned head: ceba34402e329f0365134f23fe19898756527d65
// Advisory: https://github.com/advisories/GHSA-86w9-cpqp-85rv
// The patch is exactly the upstream lib/rsa.js difference, under BSD-3-Clause.
// See fixtures/security-forge/LICENSE.node-forge for its retained license.
// Malformed signatures below are generated locally; no production key is used.
// This tests ASN.1 acceptance, not a private-key-free exploit implementation.
// Before installing the patch: node scripts/test-security-forge.mjs --expect-vulnerable
// After installing the patch:  node scripts/test-security-forge.mjs
// A temporary package copy may be selected with --forge-root <absolute-directory>.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
let expectVulnerable = false
let forgeRoot
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--expect-vulnerable') {
    expectVulnerable = true
  } else if (args[index] === '--forge-root' && args[index + 1]) {
    forgeRoot = resolve(args[++index])
  } else {
    throw new Error(`Unknown or incomplete argument: ${args[index]}`)
  }
}

function resolveForge() {
  if (forgeRoot) return createRequire(resolve(forgeRoot, 'package.json'))
  // Follow the real installed dependency links, including pnpm's patched copy.
  // node-forge is deliberately not added as a direct application dependency.
  const projectRequire = createRequire(resolve(projectRoot, 'package.json'))
  const nuxtRequire = createRequire(projectRequire.resolve('nuxt/package.json'))
  const cliRequire = createRequire(nuxtRequire.resolve('@nuxt/cli'))
  const listhenRequire = createRequire(cliRequire.resolve('listhen'))
  return createRequire(listhenRequire.resolve('node-forge'))
}

const forgeRequire = resolveForge()
const forge = forgeRoot ? forgeRequire('./lib/index.js') : forgeRequire('node-forge')
const packageFile = forgeRoot
  ? resolve(forgeRoot, 'package.json')
  : forgeRequire.resolve('node-forge/package.json')
const rsaFile = forgeRoot
  ? resolve(forgeRoot, 'lib/rsa.js')
  : forgeRequire.resolve('node-forge/lib/rsa.js')
const packageInfo = JSON.parse(readFileSync(packageFile, 'utf8'))
const sourceHash = createHash('sha256')
  .update(readFileSync(rsaFile, 'utf8').replaceAll('\r\n', '\n'))
  .digest('hex')
const originalHash = 'fd4740238145ec26470eb3f06a627c72039538ce1307dbdce40521f94dfd0a50'
const upstreamHash = 'acc22e5d36e27832c34e02dd3933aad7977d45b047eead5016520735efedc9c5'

console.log(`node-forge ${packageInfo.version}; ${expectVulnerable ? 'original vulnerability reproduction' : 'patched regression verification'}`)
console.log(`RSA source: ${rsaFile}`)

test('RSA source matches the pinned release or exact upstream PR head', () => {
  assert.equal(packageInfo.version, '1.4.0', 'Review this temporary backport when node-forge changes version')
  assert.equal(sourceHash, expectVulnerable ? originalHash : upstreamHash,
    'Unexpected RSA source: the default check requires the exact PR #1152 post-image')
})

const nativeKeys = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 })
const privatePem = nativeKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicPem = nativeKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const privateKey = forge.pki.privateKeyFromPem(privatePem)
const publicKey = forge.pki.publicKeyFromPem(publicPem)
const message = 'node-forge PR #1152 local regression control'
const algorithms = ['sha1', 'sha256', 'sha384', 'sha512']
const asn1 = forge.asn1

function digestFor(algorithm) {
  return forge.md[algorithm].create().update(message, 'utf8')
}

function oidNode(algorithm) {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
    asn1.oidToDer(forge.pki.oids[algorithm]).getBytes())
}

function nullNode() {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')
}

function signDigestInfo(algorithm, children) {
  const digestInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, children),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false,
      digestFor(algorithm).digest().getBytes())
  ])
  // NONE accepts an already encoded DigestInfo while still adding PKCS#1 v1.5
  // signature padding. This gives valid RSA padding around malformed ASN.1.
  return privateKey.sign(asn1.toDer(digestInfo).getBytes(), 'NONE')
}

function assertMalformedSignature(algorithm, signature) {
  const digest = digestFor(algorithm).digest().getBytes()
  if (expectVulnerable) {
    assert.equal(publicKey.verify(digest, signature), true,
      'Unpatched 1.4.0 must reproduce acceptance of the extra nested element')
  } else {
    assert.throws(() => publicKey.verify(digest, signature),
      /ASN\.1 object does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo value/)
  }
}

for (const algorithm of algorithms) {
  test(`${algorithm}: ordinary RSA signature and independent Node verification`, () => {
    const digest = digestFor(algorithm)
    const signature = privateKey.sign(digest)
    assert.equal(publicKey.verify(digest.digest().getBytes(), signature), true)
    assert.equal(verify(algorithm, Buffer.from(message), nativeKeys.publicKey,
      Buffer.from(signature, 'binary')), true)
    const changedDigest = forge.md[algorithm].create().update(`${message}!`, 'utf8').digest().getBytes()
    assert.equal(publicKey.verify(changedDigest, signature), false)
  })

  for (const includeNull of [false, true]) {
    test(`${algorithm}: valid DigestAlgorithm with ${includeNull ? 'NULL' : 'absent'} parameters`, () => {
      const children = [oidNode(algorithm)]
      if (includeNull) children.push(nullNode())
      const signature = signDigestInfo(algorithm, children)
      assert.equal(publicKey.verify(digestFor(algorithm).digest().getBytes(), signature), true)
    })
  }

  test(`${algorithm}: certificate generation, PEM round trip and verification`, () => {
    const certificate = forge.pki.createCertificate()
    certificate.publicKey = publicKey
    certificate.serialNumber = '01'
    certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z')
    certificate.validity.notAfter = new Date('2027-01-01T00:00:00Z')
    const subject = [{ name: 'commonName', value: 'localhost' }]
    certificate.setSubject(subject)
    certificate.setIssuer(subject)
    certificate.setExtensions([{ name: 'basicConstraints', cA: true }])
    certificate.sign(privateKey, forge.md[algorithm].create())
    const pem = forge.pki.certificateToPem(certificate)
    const parsed = forge.pki.certificateFromPem(pem)
    assert.equal(parsed.verify(parsed), true)
    assert.equal(new X509Certificate(pem).verify(nativeKeys.publicKey), true)
  })

  const invalidCases = [
    ['extra NULL after OID + NULL', () => [oidNode(algorithm), nullNode(), nullNode()]],
    ['extra OID after OID + NULL', () => [oidNode(algorithm), nullNode(), oidNode('sha1')]],
    ['extra OID with absent parameters', () => [oidNode(algorithm), oidNode('sha1')]],
    ['extra OCTET STRING after OID + NULL', () => [oidNode(algorithm), nullNode(),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, 'extra nested data')]]
  ]
  for (const [label, children] of invalidCases) {
    test(`${algorithm}: ${expectVulnerable ? 'reproduces acceptance of' : 'rejects'} ${label}`, () => {
      assertMalformedSignature(algorithm, signDigestInfo(algorithm, children()))
    })
  }
}
