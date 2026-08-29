export default defineNuxtRouteMiddleware(async () => {
  const { ready, loggedIn, user, fetch } = useUserSession()

  if (!ready.value) {
    await fetch()
  }

  if (!loggedIn.value) {
    return navigateTo('/')
  }

  if (user.value?.handle) {
    return navigateTo('/')
  }
})
