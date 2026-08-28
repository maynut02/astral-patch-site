export function readBrowserStorage(key: string): string | null {
  if (!import.meta.client) {
    return null
  }

  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeBrowserStorage(key: string, value: string): boolean {
  if (!import.meta.client) {
    return false
  }

  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeBrowserStorage(key: string): boolean {
  if (!import.meta.client) {
    return false
  }

  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
