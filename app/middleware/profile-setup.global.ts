import { useReadySession } from '~/composables/use-ready-session'

export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, user } = await useReadySession()

  if (!loggedIn.value) {
    return
  }

  const hasProfile = Boolean(user.value?.handle)

  if (!hasProfile && to.path !== '/setup') {
    return navigateTo('/setup')
  }
})
