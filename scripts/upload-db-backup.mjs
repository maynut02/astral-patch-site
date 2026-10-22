import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const BACKUP_ROOT = path.resolve('/backup')

function parseArgs(argv) {
  const options = {}

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--dump') options.dump = argv[++index]
    else if (arg === '--globals') options.globals = argv[++index]
    else if (arg === '--checksum') options.checksum = argv[++index]
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node scripts/upload-db-backup.mjs --dump <path> --globals <path> --checksum <path>

The paths must point to files mounted below /backup.
`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  for (const name of ['dump', 'globals', 'checksum']) {
    if (!options[name]) throw new Error(`--${name} is required`)
  }

  return options
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function getR2Config() {
  const accountId = requiredEnv('R2_ACCOUNT_ID')
  const endpoint = (process.env.R2_BACKUP_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`).replace(/\/$/, '')
  const endpointUrl = new URL(endpoint)

  if (endpointUrl.protocol !== 'https:') {
    throw new Error('R2_BACKUP_ENDPOINT must use https')
  }

  return {
    accessKeyId: requiredEnv('R2_BACKUP_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnv('R2_BACKUP_SECRET_ACCESS_KEY'),
    bucketName: requiredEnv('R2_BACKUP_BUCKET_NAME'),
    prefix: normalizePath(process.env.R2_BACKUP_PREFIX || 'postgres'),
    endpoint,
    host: endpointUrl.host,
    region: 'auto'
  }
}

function normalizePath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

function resolveBackupFile(filePath) {
  const resolvedPath = fs.realpathSync(path.resolve(filePath))
  const relativePath = path.relative(BACKUP_ROOT, resolvedPath)
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`Backup file must be below ${BACKUP_ROOT}: ${filePath}`)
  }

  const stat = fs.statSync(resolvedPath)
  if (!stat.isFile()) throw new Error(`Backup path is not a file: ${filePath}`)
  return { path: resolvedPath, size: stat.size }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding)
}

function encodeS3Path(value) {
  return normalizePath(value).split('/').map(part => encodeURIComponent(part)).join('/')
}

function signRequest(config, method, objectKey, payloadHash, extraHeaders = {}) {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const canonicalUri = `/${encodeS3Path(config.bucketName)}/${encodeS3Path(objectKey)}`
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const headersToSign = {
    'host': config.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(
      Object.entries(extraHeaders).map(([key, value]) => [key.toLowerCase(), String(value).trim()])
    )
  }
  const sortedHeaderNames = Object.keys(headersToSign).sort()
  const signedHeaders = sortedHeaderNames.join(';')
  const canonicalHeaders = sortedHeaderNames
    .map(key => `${key}:${headersToSign[key]}\n`)
    .join('')
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp)
  const regionKey = hmac(dateKey, config.region)
  const serviceKey = hmac(regionKey, 's3')
  const signingKey = hmac(serviceKey, 'aws4_request')
  const signature = hmac(signingKey, stringToSign, 'hex')

  return {
    url: `${config.endpoint}${canonicalUri}`,
    headers: {
      'Authorization': `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders
    }
  }
}

async function uploadFile(config, file, objectKey, contentType, payloadHash) {
  let lastError

  for (let attempt = 1; attempt <= 3; attempt++) {
    const metadataHeaders = { 'x-amz-meta-sha256': payloadHash }
    const signed = signRequest(config, 'PUT', objectKey, payloadHash, metadataHeaders)
    const stream = fs.createReadStream(file.path)

    let response
    try {
      response = await fetch(signed.url, {
        method: 'PUT',
        headers: {
          ...signed.headers,
          'content-type': contentType,
          'content-length': String(file.size)
        },
        body: stream,
        duplex: 'half',
        signal: AbortSignal.timeout(120_000)
      })
    } catch (error) {
      lastError = error
    } finally {
      stream.destroy()
    }

    if (response) {
      if (response.ok) return

      const responseBody = (await response.text().catch(() => '')).slice(0, 1000)
      lastError = new Error(`R2 PUT failed (${response.status}) for ${objectKey}${responseBody ? `: ${responseBody}` : ''}`)
      if (response.status < 500 && response.status !== 429) throw lastError
    }

    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1000))
  }

  throw lastError
}

function contentTypeForKind(kind) {
  return kind === 'checksum' || kind === 'globals'
    ? 'text/plain; charset=utf-8'
    : 'application/octet-stream'
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const config = getR2Config()
  const files = [
    { kind: 'dump', file: resolveBackupFile(options.dump) },
    { kind: 'globals', file: resolveBackupFile(options.globals) },
    { kind: 'checksum', file: resolveBackupFile(options.checksum) }
  ]

  for (const item of files) {
    const payloadHash = await sha256File(item.file.path)
    const objectName = path.basename(item.file.path)
    const objectKey = normalizePath(path.posix.join(config.prefix, objectName))
    await uploadFile(config, item.file, objectKey, contentTypeForKind(item.kind), payloadHash)
    console.log(`[r2-backup] uploaded ${objectKey} (${item.file.size} bytes)`)
  }
}

await main()
