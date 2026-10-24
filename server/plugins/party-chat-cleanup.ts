import { beginPartyShutdown, finishPartyShutdown, getPartyChatStore, getRetainedPartySessionIds } from '../utils/party-chat'

export default defineNitroPlugin((nitroApp) => {
  // Synchronous signal listeners run before Nitro asynchronously destroys sockets.
  process.once('SIGTERM', beginPartyShutdown)
  process.once('SIGINT', beginPartyShutdown)
  const timer = setInterval(() => {
    void getPartyChatStore().deleteExpiredRooms(getRetainedPartySessionIds())
      .catch(error => console.error('[party] Failed to clean up expired chat sessions', error))
    void getPartyChatStore().deleteOldConnectionEvents().catch(console.error)
  }, 60_000)
  timer.unref?.()
  nitroApp.hooks.hook('close', async () => {
    clearInterval(timer)
    await finishPartyShutdown()
  })
})
