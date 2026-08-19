import { sendRedirect } from 'h3'

export default defineOAuthGoogleEventHandler({
  config: {
    scope: ['openid', 'email', 'profile']
  },

  async onSuccess(event, { user }) {
    try {
      const appUser = await upsertGoogleUser(user)

      await setUserSession(event, {
        user: {
          id: appUser.googleSub,
          email: appUser.email,
          name: appUser.name,
          avatarUrl: appUser.avatarUrl,
          role: appUser.role
        },
        loggedInAt: Date.now()
      })

      return sendRedirect(event, '/')
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
