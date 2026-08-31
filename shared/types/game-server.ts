export interface GameLocalizedText {
  en?: string
  cn?: string
  jp?: string
  tw?: string
}

export interface GameNoticeItem {
  banner?: string
  content?: GameLocalizedText
}

export interface GameNotice {
  id: string | number
  title?: GameLocalizedText
  items?: GameNoticeItem[]
}

export interface GameServerPayload {
  server?: {
    state?: number
    hint?: GameLocalizedText
  }
  notices?: GameNotice[]
}

export interface GameServerResponse {
  fetchedAt: string
  payload?: GameServerPayload
}
