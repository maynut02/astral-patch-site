export default defineNuxtRouteMiddleware(async (to) => {
  const { ready, loggedIn, user, fetch } = useUserSession()

  if (!ready.value) {
    await fetch()
  }

  if (!loggedIn.value) {
    return
  }

  const hasProfile = Boolean(user.value?.handle)

  if (!hasProfile && to.path !== '/setup') {
    return navigateTo('/setup')
  }
})
