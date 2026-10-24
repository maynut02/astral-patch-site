import type { ReleaseFeedKey } from '#shared/types/releases'

export const PATCH_ROUTE_ITEMS = [
  { label: 'Steam 글로벌', value: 'INT_STEAM', icon: 'i-tabler-brand-steam' },
  { label: 'Steam 중국', value: 'CN_STEAM', icon: 'i-tabler-brand-steam' },
  { label: 'Android 일본', value: 'INT_ANDROID', icon: 'i-tabler-brand-android' },
  { label: 'Android 중국', value: 'CN_ANDROID', icon: 'i-tabler-brand-android' }
]

export const RELEASE_FEED_LABELS: Record<ReleaseFeedKey, string> = {
  patch: '한글패치',
  windowsPlugin: 'Windows 플러그인',
  windowsPatcher: 'Windows 패치 프로그램',
  androidPatcher: 'Android 패치 앱'
}

export const RELEASE_TAB_ITEMS: Array<{ label: string, value: ReleaseFeedKey, icon: string }> = [
  { label: '한글패치', value: 'patch', icon: 'i-tabler-package' },
  { label: '패치 프로그램', value: 'windowsPatcher', icon: 'i-tabler-brand-windows' },
  { label: '패치 앱', value: 'androidPatcher', icon: 'i-tabler-brand-android' }
]
