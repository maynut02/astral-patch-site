import { updateAdminPatchWatcherGameVersion } from '../../utils/admin-patch-watcher'
import { requireAdminSession } from '../../utils/auth-user'
import { readJsonBody } from '../../utils/request-security'

export default defineEventHandler(async (event) => {
  await requireAdminSession(event)
  const body = await readJsonBody<{ gameVersion?: unknown }>(event)
  return updateAdminPatchWatcherGameVersion(body.gameVersion)
})
