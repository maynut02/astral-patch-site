import { getPatchWatcherStatus } from '../utils/patch-watcher-status'

export default defineCachedEventHandler(async () => getPatchWatcherStatus(), {
  maxAge: 30,
  swr: false,
  name: 'patch-watcher-status-v1'
})
