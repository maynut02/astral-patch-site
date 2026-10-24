import { createError, getQuery } from 'h3'
import { getPatchWatcherHistory } from '../../utils/patch-watcher/history'
import { parsePage } from '../../utils/validation'

export default defineCachedEventHandler(async (event) => {
  const query = getQuery(event)
  const rawFilter = Array.isArray(query.filter) ? query.filter[0] : query.filter
  const page = parsePage(query.page, 'Invalid status history page')
  const filter = String(rawFilter ?? 'all')

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
