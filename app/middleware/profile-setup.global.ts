export default defineNuxtRouteMiddleware(async (to) => {
  const { ready, loggedIn, user, fetch } = useUserSession()

  if (!ready.value) {
    await fetch()
  }

  if (!loggedIn.value) {
    return
  }

  const hasProfile = Boolean(user.value?.handle && user.value?.nickname)

  if (!hasProfile && to.path !== '/profile/setup') {
    return navigateTo('/profile/setup')
  }

  if (hasProfile && to.path === '/profile/setup') {
    return navigateTo('/')
  }
})
