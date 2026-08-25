import { getQuery, sendRedirect } from 'h3'

export default defineEventHandler((event) => {
  const { returnTo } = getQuery(event)

  setAuthReturnTo(event, returnTo)

  return sendRedirect(event, '/auth/google')
})
