import { createError, getQuery } from 'h3'
import { getReleaseHistoryPage } from '../../utils/github-releases'

export default defineCachedEventHandler(async (event) => {
  const query = getQuery(event)
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page
  const page = Number.parseInt(String(rawPage ?? '1'), 10)

  if (!Number.isFinite(page) || page < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid release history page'
    })
  }

  return getReleaseHistoryPage(page)
}, {
  maxAge: 60,
  swr: false,
  name: 'github-release-history-v1'
})
