import { getCookie, getHeader, getMethod } from 'h3'

const SESSION_COOKIE_NAME = 'nuxt-session'

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== 'GET') {
    return
  }

  const accept = getHeader(event, 'accept') ?? ''
  if (!accept.includes('text/html') || !getCookie(event, SESSION_COOKIE_NAME)) {
    return
  }

  const session = await getUserSession(event)
  if (!session.user) {
    return
  }

  const { id: _sessionId, ...sessionData } = session
  await replaceUserSession(event, sessionData)
})
