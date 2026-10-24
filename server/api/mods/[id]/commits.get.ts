import { getQuery, getRouterParam } from 'h3'
import { getModCommits } from '../../../utils/mod-hub'

export default defineEventHandler((event) => {
  return getModCommits(getRouterParam(event, 'id'), getQuery(event).branch)
})
