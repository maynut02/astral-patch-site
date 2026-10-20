export type BrowserStorageKind = 'local' | 'session'

function getBrowserStorage(kind: BrowserStorageKind): Storage | null {
  if (!import.meta.client) {
    return null
  }

  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

export function readBrowserStorage(key: string, kind: BrowserStorageKind = 'local'): string | null {
  const storage = getBrowserStorage(kind)
  if (!storage) {
    return null
  }

  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

export function writeBrowserStorage(key: string, value: string, kind: BrowserStorageKind = 'local'): boolean {
  const storage = getBrowserStorage(kind)
  if (!storage) {
    return false
  }

  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeBrowserStorage(key: string, kind: BrowserStorageKind = 'local'): boolean {
  const storage = getBrowserStorage(kind)
  if (!storage) {
    return false
  }

  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}
