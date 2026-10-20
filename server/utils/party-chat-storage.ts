import type { PartyParticipant, PartyRoomMessage } from '../../shared/types/party'
import type { DatabaseClient } from './database.ts'

async function withDatabaseRetry<T>(operation: (database: DatabaseClient) => Promise<T>): Promise<T> {
  const databaseModule = await import('./database.ts')
  return databaseModule.withDatabaseRetry(operation)
}

interface SessionRow {
  id: string
  created_at: Date | string
  expires_at: Date | string
}

interface MessageRow {
  id: string
  kind: 'chat' | 'join' | 'leave'
  client_message_id: string | null
  participant_id: string | null
  participant_nickname: string | null
  character_id: PartyParticipant['characterId'] | null
  party_order: PartyParticipant['order']
  nickname: string | null
  body: string | null
  created_at: Date | string
}

export interface StoredPartyParticipant extends PartyParticipant {
  reconnectTokenHash: string
  departureDeadline: string | null
}

interface ParticipantRow {
  id: string
  nickname: string
  character_id: PartyParticipant['characterId']
  party_order: PartyParticipant['order']
  reconnect_token_hash: string
  departure_deadline: Date | string | null
}

export interface PartyConnectionEvent {
  event: 'connect' | 'join' | 'join_rejected' | 'disconnect' | 'leave_notice' | 'room_restored' | 'server_shutdown'
  roomId?: string
  sessionId?: string
  participantId?: string
  nickname?: string
  connectionId?: string
  closeCode?: number
  closeReason?: string
  departure?: 'leave' | 'page-hide' | 'loss' | 'replaced' | 'shutdown' | 'not-joined' | 'restored'
  connectedMs?: number
  detail?: Record<string, unknown>
}

interface StoredPartyRoom {
  sessionId: string
  createdAt: string
  expiresAt: string
  messages: PartyRoomMessage[]
  participants: StoredPartyParticipant[]
}

export interface PartyChatStore {
  openRoom: (roomId: string, sessionId: string, createdAt: string, expiresAt: string) => Promise<StoredPartyRoom>
  findRoom: (roomId: string) => Promise<StoredPartyRoom | null>
  upsertParticipant: (sessionId: string, participant: PartyParticipant, reconnectTokenHash: string) => Promise<void>
  updateParticipant: (participant: PartyParticipant) => Promise<void>
  setDepartureDeadline: (participantId: string, deadline: string) => Promise<void>
  // 입장이 취소된 신원을 퇴장 공지 없이 복원 대상에서 제외한다.
  discardParticipant: (participantId: string) => Promise<void>
  appendMessage: (sessionId: string, message: PartyRoomMessage, leftParticipantId?: string) => Promise<PartyRoomMessage>
  getMessagesBefore: (sessionId: string, beforeId: string, limit: number) => Promise<{
    messages: PartyRoomMessage[]
    hasMore: boolean
  }>
  extendRoom: (sessionId: string, expiresAt: string) => Promise<void>
  setRoomExpiry: (sessionId: string, expiresAt: string) => Promise<void>
  deleteRoom: (sessionId: string) => Promise<void>
  deleteExpiredRooms: (retainedSessionIds: string[]) => Promise<void>
  recordConnectionEvent: (event: PartyConnectionEvent) => Promise<void>
  deleteOldConnectionEvents: () => Promise<void>
}

function timestamp(value: Date | string): string {
  return new Date(value).toISOString()
}

function toMessage(row: MessageRow): PartyRoomMessage {
  if (row.kind === 'chat') {
    if (!row.participant_id || !row.participant_nickname || !row.character_id || !row.client_message_id || row.body === null) {
      throw new Error('Invalid party chat message row')
    }
    return {
      kind: 'chat',
      id: row.id,
      clientMessageId: row.client_message_id,
      participant: {
        id: row.participant_id,
        nickname: row.participant_nickname,
        characterId: row.character_id,
        order: row.party_order
      },
      text: row.body,
      createdAt: timestamp(row.created_at)
    }
  }

  if (row.nickname === null) throw new Error('Invalid party notice row')
  return { kind: row.kind, id: row.id, nickname: row.nickname, createdAt: timestamp(row.created_at) }
}

async function readRecentMessages(sessionId: string): Promise<PartyRoomMessage[]> {
  const rows = await withDatabaseRetry(database => database<MessageRow[]>`
    SELECT m.id, m.kind, m.client_message_id, m.participant_id,
      p.nickname AS participant_nickname, p.character_id, p.party_order,
      m.nickname, m.body, m.created_at
    FROM party_chat_messages m
    LEFT JOIN party_chat_participants p ON p.id = m.participant_id
    WHERE m.session_id = ${sessionId}
    ORDER BY m.sequence DESC
    LIMIT 300
  `)
  return rows.reverse().map(toMessage)
}

async function readActiveParticipants(sessionId: string): Promise<StoredPartyParticipant[]> {
  const rows = await withDatabaseRetry(database => database<ParticipantRow[]>`
    SELECT id, nickname, character_id, party_order, reconnect_token_hash, departure_deadline
    FROM party_chat_participants
    WHERE session_id = ${sessionId} AND left_at IS NULL AND reconnect_token_hash IS NOT NULL
  `)
  return rows.map(row => ({
    id: row.id,
    nickname: row.nickname,
    characterId: row.character_id,
    order: row.party_order,
    reconnectTokenHash: row.reconnect_token_hash,
    departureDeadline: row.departure_deadline === null ? null : timestamp(row.departure_deadline)
  }))
}

export const postgresPartyChatStore: PartyChatStore = {
  async openRoom(roomId, sessionId, createdAt, expiresAt) {
    const session = await withDatabaseRetry(database => database.begin(async (transaction) => {
      await transaction`
        DELETE FROM party_chat_sessions
        WHERE room_id = ${roomId} AND expires_at <= now()
      `
      await transaction`
        INSERT INTO party_chat_sessions (id, room_id, created_at, expires_at)
        VALUES (${sessionId}, ${roomId}, ${createdAt}, ${expiresAt})
        ON CONFLICT (room_id) DO NOTHING
      `
      const rows = await transaction<SessionRow[]>`
        SELECT id, created_at, expires_at FROM party_chat_sessions WHERE room_id = ${roomId}
      `
      if (!rows[0]) throw new Error('Could not open party chat session')
      return rows[0]
    }))

    return {
      sessionId: session.id,
      createdAt: timestamp(session.created_at),
      expiresAt: timestamp(session.expires_at),
      messages: await readRecentMessages(session.id),
      participants: await readActiveParticipants(session.id)
    }
  },

  async findRoom(roomId) {
    const rows = await withDatabaseRetry(database => database<SessionRow[]>`
      SELECT id, created_at, expires_at FROM party_chat_sessions
      WHERE room_id = ${roomId} AND expires_at > now()
    `)
    if (!rows[0]) return null
    return {
      sessionId: rows[0].id,
      createdAt: timestamp(rows[0].created_at),
      expiresAt: timestamp(rows[0].expires_at),
      messages: await readRecentMessages(rows[0].id),
      participants: await readActiveParticipants(rows[0].id)
    }
  },

  async upsertParticipant(sessionId, participant, reconnectTokenHash) {
    await withDatabaseRetry(database => database`
      INSERT INTO party_chat_participants
        (id, session_id, nickname, character_id, party_order, reconnect_token_hash)
      VALUES (${participant.id}, ${sessionId}, ${participant.nickname}, ${participant.characterId},
        ${participant.order}, ${reconnectTokenHash})
      ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname,
        character_id = EXCLUDED.character_id, party_order = EXCLUDED.party_order,
        reconnect_token_hash = EXCLUDED.reconnect_token_hash, departure_deadline = NULL, left_at = NULL
    `)
  },

  async updateParticipant(participant) {
    await withDatabaseRetry(database => database`
      UPDATE party_chat_participants
      SET character_id = ${participant.characterId}, party_order = ${participant.order}
      WHERE id = ${participant.id}
    `)
  },

  async setDepartureDeadline(participantId, deadline) {
    await withDatabaseRetry(database => database`
      UPDATE party_chat_participants SET departure_deadline = ${deadline}
      WHERE id = ${participantId} AND left_at IS NULL
    `)
  },

  async discardParticipant(participantId) {
    await withDatabaseRetry(database => database`
      UPDATE party_chat_participants SET left_at = now(), departure_deadline = NULL
      WHERE id = ${participantId}
    `)
  },

  async appendMessage(sessionId, message, leftParticipantId) {
    if (message.kind === 'chat') {
      const rows = await withDatabaseRetry(database => database.begin(async (transaction) => {
        await transaction`
          INSERT INTO party_chat_messages
            (id, session_id, kind, participant_id, client_message_id, body, created_at)
          VALUES (${message.id}, ${sessionId}, 'chat', ${message.participant.id},
            ${message.clientMessageId}, ${message.text}, ${message.createdAt})
          ON CONFLICT DO NOTHING
        `
        return transaction<MessageRow[]>`
          SELECT m.id, m.kind, m.client_message_id, m.participant_id,
            p.nickname AS participant_nickname, p.character_id, p.party_order,
            m.nickname, m.body, m.created_at
          FROM party_chat_messages m
          JOIN party_chat_participants p ON p.id = m.participant_id
          WHERE m.session_id = ${sessionId} AND m.kind = 'chat'
            AND (m.id = ${message.id}
              OR (m.participant_id = ${message.participant.id} AND m.client_message_id = ${message.clientMessageId}))
        `
      }))
      if (!rows[0]) throw new Error('Could not read stored party chat message')
      return toMessage(rows[0])
    }

    await withDatabaseRetry(database => database.begin(async (transaction) => {
      if (leftParticipantId) {
        await transaction`
          UPDATE party_chat_participants SET left_at = ${message.createdAt}, departure_deadline = NULL
          WHERE id = ${leftParticipantId}
        `
      }
      await transaction`
        INSERT INTO party_chat_messages (id, session_id, kind, nickname, created_at)
        VALUES (${message.id}, ${sessionId}, ${message.kind}, ${message.nickname}, ${message.createdAt})
        ON CONFLICT DO NOTHING
      `
    }))
    return message
  },

  async getMessagesBefore(sessionId, beforeId, limit) {
    const rows = await withDatabaseRetry(async (database) => {
      const cursor = await database<{ sequence: string }[]>`
        SELECT sequence FROM party_chat_messages
        WHERE session_id = ${sessionId} AND id = ${beforeId}
      `
      if (!cursor[0]) return []

      return database<MessageRow[]>`
        SELECT m.id, m.kind, m.client_message_id, m.participant_id,
          p.nickname AS participant_nickname, p.character_id, p.party_order,
          m.nickname, m.body, m.created_at
        FROM party_chat_messages m
        LEFT JOIN party_chat_participants p ON p.id = m.participant_id
        WHERE m.session_id = ${sessionId} AND m.sequence < ${cursor[0].sequence}
        ORDER BY m.sequence DESC
        LIMIT ${limit + 1}
      `
    })
    return { messages: rows.slice(0, limit).reverse().map(toMessage), hasMore: rows.length > limit }
  },

  async extendRoom(sessionId, expiresAt) {
    await withDatabaseRetry(database => database`
      UPDATE party_chat_sessions SET expires_at = GREATEST(expires_at, ${expiresAt})
      WHERE id = ${sessionId}
    `)
  },

  async setRoomExpiry(sessionId, expiresAt) {
    await withDatabaseRetry(database => database`
      UPDATE party_chat_sessions SET expires_at = ${expiresAt} WHERE id = ${sessionId}
    `)
  },

  async deleteRoom(sessionId) {
    await withDatabaseRetry(database => database`
      DELETE FROM party_chat_sessions WHERE id = ${sessionId}
    `)
  },

  async deleteExpiredRooms(retainedSessionIds) {
    await withDatabaseRetry(database => database`
      DELETE FROM party_chat_sessions
      WHERE expires_at <= now() AND NOT (id = ANY(${retainedSessionIds}::uuid[]))
    `)
  },

  async recordConnectionEvent(event) {
    await withDatabaseRetry(database => database`
      INSERT INTO party_chat_connection_events
        (event, room_id, session_id, participant_id, nickname, connection_id,
          close_code, close_reason, departure, connected_ms, detail)
      VALUES (${event.event}, ${event.roomId ?? null}, ${event.sessionId ?? null},
        ${event.participantId ?? null}, ${event.nickname ?? null}, ${event.connectionId ?? null},
        ${event.closeCode ?? null}, ${event.closeReason ?? null}, ${event.departure ?? null},
        ${event.connectedMs ?? null}, ${JSON.stringify(event.detail ?? {})}::jsonb)
    `)
  },

  async deleteOldConnectionEvents() {
    await withDatabaseRetry(database => database`
      DELETE FROM party_chat_connection_events WHERE created_at < now() - interval '30 days'
    `)
  }
}
