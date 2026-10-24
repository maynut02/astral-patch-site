export async function useReadySession() {
  const { ready, loggedIn, user, fetch } = useUserSession()

  if (!ready.value) {
    await fetch()
  }

  return { loggedIn, user }
}
