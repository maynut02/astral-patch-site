// 운영 의존성의 high/critical 취약점을 검사한다.
// 두 advisory 예외는 `pnpm run test:security`가 로컬 패치를 먼저 검증한다(CI에서 이 스크립트보다 앞서 실행).
// npm advisory API 네트워크 타임아웃은 한 번 재시도하고, 그래도 실패하면 경고만 남기고 통과한다.
import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const AUDIT_TIMEOUT_MS = 60_000
const RETRY_DELAY_MS = 10_000
const MAX_ATTEMPTS = 2
const TIMEOUT_PATTERN = /timeout|timed out|operation was aborted|error \(23\)/i

function runAudit() {
  const result = spawnSync('pnpm', ['audit', '--prod', '--audit-level', 'high', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
    timeout: AUDIT_TIMEOUT_MS
  })

  if (result.error && result.error.code !== 'ETIMEDOUT') {
    throw result.error
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error?.code === 'ETIMEDOUT',
    exitCode: result.status ?? 1
  }
}

function parseReport(stdout) {
  try {
    // pnpm이 JSON 앞에 엔진 경고 같은 줄을 출력할 수 있다.
    const report = JSON.parse(stdout.slice(Math.max(0, stdout.indexOf('{'))))
    let high = 0
    let critical = 0

    // pnpm 11 metadata still counts ignored advisories. The advisory
    // map contains the actionable results after level/exception filtering.
    if (report?.advisories && typeof report.advisories === 'object') {
      for (const advisory of Object.values(report.advisories)) {
        if (advisory?.severity === 'high') high += 1
        if (advisory?.severity === 'critical') critical += 1
      }
    } else {
      high = Number(report?.metadata?.vulnerabilities?.high ?? 0)
      critical = Number(report?.metadata?.vulnerabilities?.critical ?? 0)
    }

    const errorCode = Number(report?.error?.code ?? Number.NaN)
    const errorMessage = String(report?.error?.message ?? '')

    return {
      high,
      critical,
      timeoutError: errorCode === 23 || TIMEOUT_PATTERN.test(errorMessage)
    }
  } catch {
    // JSON 보고서가 없는 네트워크 오류는 출력 검사에서 판별한다.
    return { high: 0, critical: 0, timeoutError: false }
  }
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const audit = runAudit()
  process.stdout.write(audit.stdout)
  process.stderr.write(audit.stderr)

  const report = parseReport(audit.stdout)

  if (report.high > 0 || report.critical > 0) {
    console.error(`High/critical vulnerabilities found: high=${report.high}, critical=${report.critical}`)
    process.exit(1)
  }

  if (!audit.timedOut && audit.exitCode === 0) {
    process.exit(0)
  }

  const isTimeout = audit.timedOut
    || report.timeoutError
    || TIMEOUT_PATTERN.test(audit.stdout)
    || TIMEOUT_PATTERN.test(audit.stderr)

  if (!isTimeout) {
    console.error(`pnpm audit failed for a non-timeout reason (exit code ${audit.exitCode}).`)
    process.exit(audit.exitCode)
  }

  if (attempt === MAX_ATTEMPTS) {
    console.log('::warning::pnpm audit could not reach the npm security advisory API because of a network timeout. High/critical vulnerability status could not be verified in this run.')
    process.exit(0)
  }

  await sleep(RETRY_DELAY_MS)
}
