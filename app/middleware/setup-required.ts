import { useReadySession } from '~/composables/use-ready-session'

export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn, user } = await useReadySession()

  if (!loggedIn.value) {
    return navigateTo('/')
  }

  if (user.value?.handle) {
    return navigateTo('/')
  }
})
