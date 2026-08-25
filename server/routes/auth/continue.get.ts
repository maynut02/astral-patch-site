import { sendRedirect } from 'h3'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const returnTo = consumeAuthReturnTo(event)

  return sendRedirect(event, session.user ? returnTo : '/')
})
