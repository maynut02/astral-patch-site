import { getReleaseFeed } from '../utils/github-releases'

export default defineCachedEventHandler(async () => getReleaseFeed(), {
  maxAge: 60,
  swr: false,
  name: 'github-release-feed-v6'
})
