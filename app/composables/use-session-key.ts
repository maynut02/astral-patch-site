import { computed } from 'vue'

function getSessionKeyPart(value: string | null | undefined): string {
  // Match JSON tuple normalization without conflating nullish values and empty strings.
  return value == null ? 'n' : `${value.length}:${value}`
}

export function useSessionKey() {
  const { loggedIn, user } = useUserSession()

  return computed(() => {
    const sessionUser = user.value
    return `${loggedIn.value ? '1' : '0'}:${getSessionKeyPart(sessionUser?.id)}:${getSessionKeyPart(sessionUser?.role)}`
  })
}
