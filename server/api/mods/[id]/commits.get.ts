import { getQuery, getRouterParam, setResponseHeader } from 'h3'
import { getModCommits } from '../../../utils/mod-hub'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return getModCommits(getRouterParam(event, 'id'), getQuery(event).branch)
})
