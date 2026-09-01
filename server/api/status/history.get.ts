import { createError, getQuery } from 'h3'
import { getPatchWatcherHistory } from '../../utils/patch-watcher-status'

export default defineCachedEventHandler(async (event) => {
  const query = getQuery(event)
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page
  const rawFilter = Array.isArray(query.filter) ? query.filter[0] : query.filter
  const page = Number.parseInt(String(rawPage ?? '1'), 10)
  const filter = String(rawFilter ?? 'all')

  if (!Number.isFinite(page) || page < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid status history page'
    })
  }

  if (filter !== 'all' && filter !== 'failed') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid status history filter'
    })
  }

  return getPatchWatcherHistory(page, filter === 'failed')
}, {
  maxAge: 30,
  swr: false,
  name: 'patch-watcher-status-history-v2'
})
