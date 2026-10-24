import { PARTY_HISTORY_MAX_BYTES, PARTY_HISTORY_MAX_MESSAGES, PARTY_MAX_NICKNAME_LENGTH, PARTY_MAX_TEXT_LENGTH } from '../../shared/types/party.ts'

export const PARTY_LIMITS = Object.freeze({
  maxRooms: 200,
  maxConnections: 500,
  maxConnectionsPerIp: 20,
  maxJoinAttemptsPerIp: 12,
  joinAttemptWindowMs: 60_000,
  maxMessagesPerWindow: 60,
  messageWindowMs: 60_000,
  maxIncomingMessageBytes: 16 * 1024,
  maxOutgoingMessageBytes: 1024 * 1024,
  maxBufferedBytes: 1024 * 1024,
  emptyRoomTtlMs: 3 * 60_000,
  pageHideGraceMs: 15_000,
  connectionLossGraceMs: 60_000,
  heartbeatIntervalMs: 20_000,
  heartbeatTimeoutMs: 60_000,
  maxNicknameLength: PARTY_MAX_NICKNAME_LENGTH,
  maxTextLength: PARTY_MAX_TEXT_LENGTH,
  maxClientMessageIdLength: 128,
  maxReconnectTokenLength: 128,
  historyLimit: PARTY_HISTORY_MAX_MESSAGES,
  historyMaxBytes: PARTY_HISTORY_MAX_BYTES
})
