import { getAdminPatchWatcherConfig } from '../../utils/admin-patch-watcher'
import { requireAdminSession } from '../../utils/auth-user'

export default defineEventHandler(async (event) => {
  await requireAdminSession(event)
  return getAdminPatchWatcherConfig()
})
