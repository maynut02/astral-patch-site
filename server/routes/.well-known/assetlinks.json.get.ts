const SHA256_HEX_PATTERN = /^[A-F0-9]{64}$/

function normalizeSha256Fingerprint(value: string): string | null {
  const hex = value.replaceAll(':', '').trim().toUpperCase()
  if (!SHA256_HEX_PATTERN.test(hex)) return null

  return hex.match(/.{2}/g)?.join(':') ?? null
}

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const fingerprint = normalizeSha256Fingerprint(config.androidCertificateSha256)

  if (!fingerprint) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Android certificate SHA-256 fingerprint is not configured'
    })
  }

  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')

  return [
    {
      relation: [
        'delegate_permission/common.handle_all_urls'
      ],
      target: {
        namespace: 'android_app',
        package_name: 'com.maynutlab.astralpatcher',
        sha256_cert_fingerprints: [fingerprint]
      }
    }
  ]
})
