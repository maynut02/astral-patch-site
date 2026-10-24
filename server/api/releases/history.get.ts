import { getQuery } from 'h3'
import { getReleaseHistoryPage } from '../../utils/github-releases'
import { parsePage } from '../../utils/validation'

export default defineCachedEventHandler(async (event) => {
  const query = getQuery(event)
  const page = parsePage(query.page, 'Invalid release history page')

  return getReleaseHistoryPage(page)
}, {
  maxAge: 60,
  swr: false,
  name: 'github-release-history-v2'
})
