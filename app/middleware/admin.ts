export default defineNuxtRouteMiddleware(async () => {
  const { ready, loggedIn, user, fetch } = useUserSession()

  if (!ready.value) {
    await fetch()
  }

  if (!loggedIn.value || user.value?.role !== 'admin') {
    return navigateTo('/')
  }
})
