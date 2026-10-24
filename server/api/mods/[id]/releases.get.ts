import { getQuery, getRouterParam } from 'h3'
import { getModReleases } from '../../../utils/mod-hub'

export default defineEventHandler((event) => {
  return getModReleases(getRouterParam(event, 'id'), getQuery(event).page)
})
