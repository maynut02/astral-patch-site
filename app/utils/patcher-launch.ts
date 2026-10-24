export function launchWindowsPatcher(
  action: 'settings' | 'install' | 'remove',
  route?: 'INT_STEAM' | 'CN_STEAM'
): void {
  if (!import.meta.client) {
    return
  }

  const routeSuffix = route ? `/${route}` : ''
  window.location.href = `astral://${action}${routeSuffix}`
}
