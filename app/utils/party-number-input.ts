import { PARTY_ROOM_ID_LENGTH } from '#shared/types/party'

export function sanitizePartyNumberInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const original = input.value
  const cursor = input.selectionStart ?? original.length
  const value = original.replace(/[^0-9]/g, '').slice(0, PARTY_ROOM_ID_LENGTH)
  if (value === original) return

  // Update the native input before UInput reads it, even if the model is unchanged.
  input.value = value
  const nextCursor = Math.min(original.slice(0, cursor).replace(/[^0-9]/g, '').length, value.length)
  input.setSelectionRange(nextCursor, nextCursor)
}

export function pastePartyNumber(event: ClipboardEvent): void {
  if (!event.clipboardData) return
  event.preventDefault()
  const input = event.target as HTMLInputElement
  const digits = event.clipboardData.getData('text/plain').replace(/[^0-9]/g, '')
  if (!digits) return

  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  const available = Math.max(0, PARTY_ROOM_ID_LENGTH - (input.value.length - (end - start)))
  input.setRangeText(digits.slice(0, available), start, end, 'end')
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
