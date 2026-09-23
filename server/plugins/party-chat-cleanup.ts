import { postgresPartyChatStore } from '../utils/party-chat-storage'
import { getRetainedPartySessionIds } from '../utils/party-chat'

export default defineNitroPlugin((nitroApp) => {
  const timer = setInterval(() => {
    void postgresPartyChatStore.deleteExpiredRooms(getRetainedPartySessionIds())
      .catch(error => console.error('[party] Failed to clean up expired chat sessions', error))
  }, 60_000)
  timer.unref?.()
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
