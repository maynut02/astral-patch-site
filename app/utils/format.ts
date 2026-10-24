const numberFormatter = new Intl.NumberFormat('ko-KR')
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Seoul'
})

export function formatCount(value: number): string {
  return numberFormatter.format(value)
}

export function formatDate(value: string): string {
  if (!value) {
    return '시간 정보 없음'
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '시간 정보 없음' : dateFormatter.format(date)
}

export function formatFetchedAgo(value: string, nowValue: number | null = null, fallback = '시간 정보 없음'): string {
  if (!value) {
    return fallback
  }

  const fetchedAt = new Date(value).getTime()
  if (Number.isNaN(fetchedAt)) {
    return fallback
  }

  const now = nowValue ?? fetchedAt
  const elapsedSeconds = Math.max(0, Math.floor((now - fetchedAt) / 1000))

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}초 전`
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}분 전`
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `${elapsedHours}시간 전`
  }

  return `${Math.floor(elapsedHours / 24)}일 전`
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / (1024 ** unitIndex)
  const fractionDigits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2

  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}
