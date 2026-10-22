import { createHash, createHmac } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createError } from 'h3'

export interface R2BucketConfig {
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  endpoint: string
  host: string
}

const REGION = 'auto'
// Worst case per object is 3 x 10s plus backoff, keeping a publish (two PUTs) under the 90s proxy timeout.
const REQUEST_TIMEOUT_MS = 10_000
const MAX_ATTEMPTS = 3

function readEnv(name: string): string {
  return String(process.env[name] || '').trim()
}

export function getTranslationPackBucketConfig(): R2BucketConfig {
  const accountId = readEnv('R2_ACCOUNT_ID')
  const accessKeyId = readEnv('R2_PACK_ACCESS_KEY_ID')
  const secretAccessKey = readEnv('R2_PACK_SECRET_ACCESS_KEY')
  const bucketName = readEnv('R2_PACK_BUCKET_NAME')

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Translation pack storage is not configured'
    })
  }

  const host = `${accountId}.r2.cloudflarestorage.com`

  return {
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint: `https://${host}`,
    host
  }
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function encodeObjectPath(value: string): string {
  return value.split('/').map(part => encodeURIComponent(part)).join('/')
}

function signRequest(config: R2BucketConfig, method: string, objectKey: string, payloadHash: string) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const canonicalUri = `/${encodeObjectPath(config.bucketName)}/${encodeObjectPath(objectKey)}`
  const credentialScope = `${dateStamp}/${REGION}/s3/aws4_request`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalHeaders = `host:${config.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), REGION), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return {
    url: `${config.endpoint}${canonicalUri}`,
    headers: {
      'Authorization': `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    }
  }
}

async function sendWithRetry(
  config: R2BucketConfig,
  method: 'PUT' | 'DELETE',
  objectKey: string,
  body: Uint8Array<ArrayBuffer> | undefined,
  headers: Record<string, string>
): Promise<void> {
  const payloadHash = sha256Hex(body ?? '')
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const signed = signRequest(config, method, objectKey, payloadHash)
    let response: Response | undefined

    try {
      response = await fetch(signed.url, {
        method,
        headers: { ...signed.headers, ...headers },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error: unknown) {
      lastError = error
    }

    if (response) {
      // R2 answers DELETE with 204 even when the object is already gone.
      if (response.ok) {
        return
      }

      const responseBody = (await response.text().catch(() => '')).slice(0, 500)
      lastError = new Error(`R2 ${method} failed (${response.status}) for ${objectKey}${responseBody ? `: ${responseBody}` : ''}`)

      if (response.status < 500 && response.status !== 429) {
        throw lastError
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      await delay(attempt * 1000)
    }
  }

  throw lastError
}

export function putR2Object(
  config: R2BucketConfig,
  objectKey: string,
  body: Uint8Array<ArrayBuffer>,
  options: { contentType: string, cacheControl: string }
): Promise<void> {
  return sendWithRetry(config, 'PUT', objectKey, body, {
    'content-type': options.contentType,
    'cache-control': options.cacheControl,
    'content-length': String(body.byteLength)
  })
}

export function deleteR2Object(config: R2BucketConfig, objectKey: string): Promise<void> {
  return sendWithRetry(config, 'DELETE', objectKey, undefined, {})
}
