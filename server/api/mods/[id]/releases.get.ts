import { getQuery, getRouterParam, setResponseHeader } from 'h3'
import { getModReleases } from '../../../utils/mod-hub'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return getModReleases(getRouterParam(event, 'id'), getQuery(event).page)
})
