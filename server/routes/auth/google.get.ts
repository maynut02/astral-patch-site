import { sendRedirect } from 'h3'

export default defineOAuthGoogleEventHandler({
  config: {
    scope: ['openid', 'email']
  },

  async onSuccess(event, { user }) {
    try {
      const appUser = await upsertGoogleUser(user)

      await setUserSession(event, {
        user: {
          id: appUser.googleSub,
          email: appUser.email,
          name: appUser.name,
          handle: appUser.handle,
          nickname: appUser.nickname,
          role: appUser.role,
          userType: appUser.userType
        },
        loggedInAt: Date.now()
      })

      return sendRedirect(event, appUser.handle && appUser.nickname ? '/' : '/profile/setup')
    } catch (error) {
      console.error('[auth/google] failed to create session', error)
      return sendRedirect(event, '/?authError=google')
    }
  },

  onError(event, error) {
    console.error('[auth/google] OAuth error', error)
    return sendRedirect(event, '/?authError=google')
  }
})
