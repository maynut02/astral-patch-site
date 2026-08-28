import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`[dev] ${name} is required in .env`)
  return value
}

function parsePort(name, fallback) {
  const raw = String(process.env[name] || fallback)
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`[dev] ${name} must be a valid TCP port`)
  }
  return value
}

function canConnect(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let settled = false

    const finish = (connected) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(connected)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function waitForPort(host, port, timeoutMs = 15_000) {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port })
      let settled = false

      const finishAttempt = (error) => {
        if (settled) return
        settled = true
        socket.destroy()

        if (!error) {
          resolve()
          return
        }

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`[dev] SSH tunnel did not become ready on ${host}:${port}`))
          return
        }

        setTimeout(tryConnect, 250)
      }

      socket.setTimeout(1000)
      socket.once('connect', () => finishAttempt())
      socket.once('timeout', () => finishAttempt(new Error('timeout')))
      socket.once('error', finishAttempt)
    }

    tryConnect()
  })
}

function assertDevelopmentDatabaseUrl(databaseUrl, localPort) {
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('[dev] DATABASE_URL is not a valid URL')
  }

  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(
      `[dev] DATABASE_URL must use localhost/127.0.0.1 when pnpm dev manages the SSH tunnel; received ${url.hostname}`,
    )
  }

  if (Number.parseInt(url.port, 10) !== localPort) {
    throw new Error(
      `[dev] DATABASE_URL must use local tunnel port ${localPort}; received ${url.port || '(none)'}`,
    )
  }
}

const sshHost = requiredEnv('ASTRAL_SSH_HOST')
const sshUser = String(process.env.ASTRAL_SSH_USER || 'ubuntu').trim()
const sshKeyPath = String(process.env.ASTRAL_SSH_KEY_PATH || '').trim()
const sshPort = parsePort('ASTRAL_SSH_PORT', 22)
const localPort = parsePort('ASTRAL_DEV_DB_LOCAL_PORT', 55433)
const remoteHost = String(process.env.ASTRAL_DEV_DB_REMOTE_HOST || '127.0.0.1').trim()
const remotePort = parsePort('ASTRAL_DEV_DB_REMOTE_PORT', 5433)
const databaseUrl = requiredEnv('DATABASE_URL')

assertDevelopmentDatabaseUrl(databaseUrl, localPort)

if (await canConnect('127.0.0.1', localPort)) {
  throw new Error(
    `[dev] Local port ${localPort} is already in use. Stop the existing tunnel/process before running pnpm dev.`,
  )
}

const sshTarget = sshHost.includes('@') ? sshHost : `${sshUser}@${sshHost}`
const sshArgs = [
  '-N',
  '-o', 'BatchMode=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-p', String(sshPort),
]

if (sshKeyPath) sshArgs.push('-i', sshKeyPath)
sshArgs.push('-L', `${localPort}:${remoteHost}:${remotePort}`, sshTarget)

console.log(`[dev] Opening database SSH tunnel: 127.0.0.1:${localPort} -> ${remoteHost}:${remotePort}`)
const ssh = spawn('ssh', sshArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
let sshReady = false
let nuxt
let shuttingDown = false

ssh.stderr.on('data', (data) => {
  const message = data.toString().trim()
  if (message) console.error(`[dev:ssh] ${message}`)
})

const sshEarlyExit = new Promise((_, reject) => {
  ssh.once('exit', (code, signal) => {
    if (!sshReady) {
      reject(new Error(`[dev] SSH tunnel exited before becoming ready (${signal || code || 0})`))
      return
    }

    if (!shuttingDown && nuxt) {
      console.error(`[dev] SSH tunnel exited unexpectedly (${signal || code || 0}); stopping Nuxt.`)
      nuxt.kill('SIGTERM')
    }
  })
})

try {
  await Promise.race([
    waitForPort('127.0.0.1', localPort),
    sshEarlyExit,
  ])
  sshReady = true
} catch (error) {
  ssh.kill('SIGTERM')
  throw error
}

console.log('[dev] Database tunnel is ready. Starting Nuxt dev server.')
const nuxtCli = path.resolve(process.cwd(), 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')
nuxt = spawn(process.execPath, [nuxtCli, 'dev'], {
  env: process.env,
  stdio: 'inherit',
})

function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true

  if (nuxt && !nuxt.killed) nuxt.kill(signal)
  if (!ssh.killed) ssh.kill(signal)
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

nuxt.once('exit', (code, signal) => {
  shutdown('SIGTERM')
  process.exitCode = code ?? (signal ? 1 : 0)
})
