import { PARTY_SPECTATOR_ID, PARTY_UNSELECTED_ID, type PartyCharacterId, type PartyOrder } from '#shared/types/party'

export const orderColors: Record<PartyOrder, string> = {
  P1: 'bg-error/15 text-error',
  P2: 'bg-success/15 text-success',
  P3: 'bg-info/15 text-info',
  P4: 'bg-warning/15 text-warning'
}

export const orderHoverColors: Record<PartyOrder, string> = {
  P1: 'enabled:hover:bg-error/15',
  P2: 'enabled:hover:bg-success/15',
  P3: 'enabled:hover:bg-info/15',
  P4: 'enabled:hover:bg-warning/15'
}

export function getPartyCharacterName(id: PartyCharacterId, names: ReadonlyMap<PartyCharacterId, string>): string {
  if (id === PARTY_UNSELECTED_ID) return '미선택'
  return id === PARTY_SPECTATOR_ID ? '관전' : names.get(id) || `캐릭터 #${id}`
}

export function getPartyCharacterIcon(id: PartyCharacterId): string | undefined {
  if (id === PARTY_UNSELECTED_ID) return 'i-tabler-user-question'
  return id === PARTY_SPECTATOR_ID ? 'i-tabler-eye' : undefined
}

export function formatPartyTime(value: string): string {
  return new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}
