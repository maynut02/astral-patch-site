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

interface StoredPartyRoom {
  sessionId: string
  createdAt: string
  expiresAt: string
  messages: PartyRoomMessage[]
}

export interface PartyChatStore {
  openRoom: (roomId: string, sessionId: string, createdAt: string, expiresAt: string) => Promise<StoredPartyRoom>
  findRoom: (roomId: string) => Promise<StoredPartyRoom | null>
  addParticipant: (sessionId: string, participant: PartyParticipant) => Promise<void>
  updateParticipant: (participant: PartyParticipant) => Promise<void>
  appendMessage: (sessionId: string, message: PartyRoomMessage) => Promise<void>
  getMessagesBefore: (sessionId: string, beforeId: string, limit: number) => Promise<{
    messages: PartyRoomMessage[]
    hasMore: boolean
  }>
  extendRoom: (sessionId: string, expiresAt: string) => Promise<void>
  setRoomExpiry: (sessionId: string, expiresAt: string) => Promise<void>
  deleteRoom: (sessionId: string) => Promise<void>
  deleteExpiredRooms: (retainedSessionIds: string[]) => Promise<void>
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
      messages: await readRecentMessages(session.id)
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
      messages: await readRecentMessages(rows[0].id)
    }
  },

  async addParticipant(sessionId, participant) {
    await withDatabaseRetry(database => database`
      INSERT INTO party_chat_participants (id, session_id, nickname, character_id, party_order)
      VALUES (${participant.id}, ${sessionId}, ${participant.nickname}, ${participant.characterId}, ${participant.order})
      ON CONFLICT (id) DO NOTHING
    `)
  },

  async updateParticipant(participant) {
    await withDatabaseRetry(database => database`
      UPDATE party_chat_participants
      SET character_id = ${participant.characterId}, party_order = ${participant.order}
      WHERE id = ${participant.id}
    `)
  },

  async appendMessage(sessionId, message) {
    if (message.kind === 'chat') {
      await withDatabaseRetry(database => database`
        INSERT INTO party_chat_messages
          (id, session_id, kind, participant_id, client_message_id, body, created_at)
        VALUES (${message.id}, ${sessionId}, 'chat', ${message.participant.id},
          ${message.clientMessageId}, ${message.text}, ${message.createdAt})
        ON CONFLICT (id) DO NOTHING
      `)
      return
    }

    await withDatabaseRetry(database => database`
      INSERT INTO party_chat_messages (id, session_id, kind, nickname, created_at)
      VALUES (${message.id}, ${sessionId}, ${message.kind}, ${message.nickname}, ${message.createdAt})
      ON CONFLICT (id) DO NOTHING
    `)
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
  }
}
