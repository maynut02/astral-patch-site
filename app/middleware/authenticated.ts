import { useReadySession } from '~/composables/use-ready-session'

export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn } = await useReadySession()

  if (!loggedIn.value) {
    return navigateTo('/')
  }
})
