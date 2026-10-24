import { isReviewerRole } from '#shared/types/user'

export interface NavItem {
  link: string
  icon: string
  label: string
  emphasis?: 'info'
}

const publicNavItems: NavItem[] = [
  { link: '/', icon: 'i-tabler-home', label: '홈' },
  { link: '/download', icon: 'i-tabler-download', label: '다운로드' },
  { link: '/release', icon: 'i-tabler-clipboard-check', label: '릴리즈 노트' },
  { link: '/translate', icon: 'i-tabler-language', label: '번역 대시보드' },
  { link: '/change', icon: 'i-tabler-history-toggle', label: '변경 기록' },
  { link: '/status', icon: 'i-tabler-activity-heartbeat', label: '서비스 상태' },
  { link: '/mod', icon: 'i-tabler-package', label: '모드 허브' },
  { link: '/party', icon: 'i-tabler-users-group', label: '파티 채팅' },
  { link: '/notice', icon: 'i-tabler-speakerphone', label: '공지사항' },
  { link: '/contributor', icon: 'i-tabler-user-heart', label: '기여자' }
]

export function getNavigationItems(role: unknown): NavItem[] {
  return [
    ...publicNavItems,
    ...(isReviewerRole(role)
      ? [{ link: '/translate/review', icon: 'i-tabler-checkup-list', label: '번역 승인', emphasis: 'info' as const }]
      : []),
    ...(role === 'admin'
      ? [{ link: '/admin', icon: 'i-tabler-shield-lock', label: '관리자', emphasis: 'info' as const }]
      : [])
  ]
}

export function isPartyRoomNavItem(item: NavItem, isPartyRoom: boolean): boolean {
  return item.link === '/party' && isPartyRoom
}
