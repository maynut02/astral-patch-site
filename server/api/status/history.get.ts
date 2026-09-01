import { createError, getQuery } from 'h3'
import { getPatchWatcherHistory } from '../../utils/patch-watcher-status'

export default defineCachedEventHandler(async (event) => {
  const query = getQuery(event)
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page
  const page = Number.parseInt(String(rawPage ?? '1'), 10)

  if (!Number.isFinite(page) || page < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid status history page'
    })
  }

  return getPatchWatcherHistory(page)
}, {
  maxAge: 30,
  swr: false,
  name: 'patch-watcher-status-history-v1'
})
