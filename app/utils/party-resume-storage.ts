import { readBrowserStorage, removeBrowserStorage, writeBrowserStorage } from '~/utils/browser-storage'
import { normalizeNicknameKey } from '~/utils/party-message-merge'

interface PartyResumeRecord {
  version: 1
  roomId: string
  sessionId: string
  nicknameKey: string
  reconnectToken: string
}

export interface PartyResumeContext {
  reconnectToken: string
  sessionId: string
}

// 한 탭은 한 번에 하나의 채팅 세션만 이어가므로 재개 기록도 탭 단위로 보관한다.
const RESUME_STORAGE_KEY = 'party-chat-resume'
const RESUME_STORAGE_VERSION = 1 as const

function isPartyResumeRecord(value: unknown): value is PartyResumeRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.version === RESUME_STORAGE_VERSION
    && typeof record.roomId === 'string'
    && typeof record.sessionId === 'string'
    && record.sessionId.length > 0
    && typeof record.nicknameKey === 'string'
    && record.nicknameKey.length > 0
    && typeof record.reconnectToken === 'string'
    && record.reconnectToken.length > 0
}

export function readResumeRecord(): PartyResumeRecord | null {
  const stored = readBrowserStorage(RESUME_STORAGE_KEY, 'session')
  if (!stored) return null
  try {
    const parsed: unknown = JSON.parse(stored)
    if (isPartyResumeRecord(parsed)) return parsed
  } catch {
    // 손상된 재개 기록은 버리고 새 입장으로 진행한다.
  }
  removeBrowserStorage(RESUME_STORAGE_KEY, 'session')
  return null
}

export function clearResumeRecord() {
  removeBrowserStorage(RESUME_STORAGE_KEY, 'session')
}

export function persistResumeRecord(roomId: string, nickname: string, reconnectToken: string, sessionIdValue: string) {
  const record: PartyResumeRecord = {
    version: RESUME_STORAGE_VERSION,
    roomId,
    sessionId: sessionIdValue,
    nicknameKey: normalizeNicknameKey(nickname),
    reconnectToken
  }
  writeBrowserStorage(RESUME_STORAGE_KEY, JSON.stringify(record), 'session')
}

export function getPartyResumeContext(roomId: string, nickname: string): PartyResumeContext | null {
  const record = readResumeRecord()
  if (!record) return null
  // 다른 방이나 다른 닉네임의 기록은 재사용하지 않고 즉시 정리한다.
  if (record.roomId !== roomId || record.nicknameKey !== normalizeNicknameKey(nickname)) {
    clearResumeRecord()
    return null
  }
  return { reconnectToken: record.reconnectToken, sessionId: record.sessionId }
}
