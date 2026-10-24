import { isReviewerRole } from '#shared/types/user'
import { useReadySession } from '~/composables/use-ready-session'

export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn, user } = await useReadySession()

  if (!loggedIn.value || !isReviewerRole(user.value?.role)) {
    return navigateTo('/')
  }
})
