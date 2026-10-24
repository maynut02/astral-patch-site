import type { ModPlatform } from '#shared/types/mod'

export const MOD_PLATFORM_ITEMS: Array<{ value: ModPlatform, label: string, icon: string }> = [
  { value: 'windows', label: 'Windows', icon: 'i-tabler-brand-windows' },
  { value: 'android', label: 'Android', icon: 'i-tabler-brand-android' }
]

export function getModPlatformLabel(platform: ModPlatform, fallback: string = platform): string {
  return MOD_PLATFORM_ITEMS.find(item => item.value === platform)?.label ?? fallback
}

export function getModPlatformIcon(platform: ModPlatform): string {
  return MOD_PLATFORM_ITEMS.find(item => item.value === platform)?.icon ?? 'i-tabler-device-desktop'
}

export function formatModDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric'
      }).format(date)
}

export function formatModFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
