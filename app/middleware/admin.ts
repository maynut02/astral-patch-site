import { useReadySession } from '~/composables/use-ready-session'

export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn, user } = await useReadySession()

  if (!loggedIn.value || user.value?.role !== 'admin') {
    return navigateTo('/')
  }
})
