import { createError, getHeader, getRequestIP, setResponseHeader } from 'h3'
import { readJsonBody } from '../../utils/request-security'
import { createPartyRoom, isPartyNicknameTaken, normalizePartyNickname } from '../../utils/party-chat'

interface CreatePartyRoomBody extends Record<string, unknown> {
  roomId?: unknown
  nickname?: unknown
}

interface CreateAttemptState {
  count: number
  windowStartedAt: number
}

const CREATE_ATTEMPT_LIMIT = 12
const CREATE_ATTEMPT_WINDOW_MS = 60_000
const createAttemptsByIp = new Map<string, CreateAttemptState>()

function getClientIp(event: Parameters<typeof getRequestIP>[0]): string {
  if (process.env.ASTRAL_TRUST_PROXY === 'true') {
    return getHeader(event, 'x-real-ip')?.trim()
      || getRequestIP(event)
      || 'unknown'
  }

  return getRequestIP(event) || 'unknown'
}

function consumeCreateAttempt(ipAddress: string, now: number): boolean {
  for (const [key, attempt] of createAttemptsByIp) {
    if (now - attempt.windowStartedAt >= CREATE_ATTEMPT_WINDOW_MS) {
      createAttemptsByIp.delete(key)
    }
  }

  const current = createAttemptsByIp.get(ipAddress)
  if (!current || now - current.windowStartedAt >= CREATE_ATTEMPT_WINDOW_MS) {
    createAttemptsByIp.set(ipAddress, {
      count: 1,
      windowStartedAt: now
    })
    return true
  }

  current.count++
  return current.count <= CREATE_ATTEMPT_LIMIT
}

function throwCreateRoomError(code: string, message: string): never {
  const statusCode = code === 'ROOM_LIMIT' ? 503 : 400

  throw createError({ statusCode, message })
}

export default defineEventHandler(async (event) => {
  if (!consumeCreateAttempt(getClientIp(event), Date.now())) {
    throw createError({
      statusCode: 429,
      message: '방 입장 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    })
  }

  const body = await readJsonBody<CreatePartyRoomBody>(event)
  if ('password' in body) {
    throw createError({ statusCode: 400, message: '비밀번호 방은 더 이상 지원하지 않습니다.' })
  }
  const nickname = 'nickname' in body ? normalizePartyNickname(body.nickname) : null
  if ('nickname' in body && !nickname) {
    throw createError({ statusCode: 400, message: '닉네임은 1~20자여야 합니다.' })
  }
  const result = await createPartyRoom(body.roomId)

  if (!result.ok) {
    throwCreateRoomError(result.code, result.message)
  }

  if (nickname && isPartyNicknameTaken(result.room.roomId, nickname)) {
    throw createError({
      statusCode: 409,
      message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.'
    })
  }

  setResponseHeader(event, 'Cache-Control', 'no-store')
  return result.room
})
