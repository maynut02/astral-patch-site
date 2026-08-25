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
          handle: appUser.handle,
          role: appUser.role
        },
        loggedInAt: Date.now()
      })

      if (!appUser.handle) {
        return sendRedirect(event, '/setup')
      }

      return sendRedirect(event, consumeAuthReturnTo(event))
    } catch (error) {
      console.error('[auth/google] failed to create session', error)
      return sendRedirect(event, withAuthError(consumeAuthReturnTo(event)))
    }
  },

  onError(event, error) {
    console.error('[auth/google] OAuth error', error)
    return sendRedirect(event, withAuthError(consumeAuthReturnTo(event)))
  }
})
