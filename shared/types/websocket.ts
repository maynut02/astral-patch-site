import type { EditorComment } from './editor-comment'

export interface AstralWebSocketMessage {
  type: string
  [key: string]: unknown
}

export const ASTRAL_WS_TOPICS = [
  'editor',
  'editor:comment',
  'change:translation'
] as const

export type AstralWebSocketTopic = typeof ASTRAL_WS_TOPICS[number]

export interface AstralWebSocketWelcomeMessage extends AstralWebSocketMessage {
  type: 'WELCOME'
  clientId: string
}

export interface AstralWebSocketPingMessage extends AstralWebSocketMessage {
  type: 'WS_PING'
  timestamp: number
}

export interface AstralWebSocketPongMessage extends AstralWebSocketMessage {
  type: 'WS_PONG'
}

export interface AstralWebSocketSubscribeMessage extends AstralWebSocketMessage {
  type: 'WS_SUBSCRIBE'
  topics: AstralWebSocketTopic[]
}

export interface AstralWebSocketUnsubscribeMessage extends AstralWebSocketMessage {
  type: 'WS_UNSUBSCRIBE'
  topics: AstralWebSocketTopic[]
}

export interface AstralEditorItemChangedMessage extends AstralWebSocketMessage {
  type: 'EDITOR_ITEM_CHANGED'
  itemId: string
  changeId: string
}

export interface AstralEditorItemReviewedMessage extends AstralWebSocketMessage {
  type: 'EDITOR_ITEM_REVIEWED'
  itemId: string
  changeId: string
  status: 'approved' | 'rejected'
  supersededChangeIds: string[]
}

export interface AstralEditorCommentCreatedMessage extends AstralWebSocketMessage {
  type: 'EDITOR_COMMENT_CREATED'
  comment: EditorComment
}

export type AstralWebSocketConnectionStatus
  = 'idle'
    | 'connecting'
    | 'open'
    | 'closed'
    | 'error'
