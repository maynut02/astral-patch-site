export function cleanGameText(value?: string): string {
  return (value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\[(?:\/?b|\/?color[^\]]*|\/?size[^\]]*|\/?url[^\]]*)\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function escapeGameNoticeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#039;')
}

function getSafeGameNoticeUrl(value: string): string | null {
  const url = value.trim()
  return /^https?:\/\//i.test(url) ? url : null
}

export function formatGameNoticeHtml(value?: string): string {
  const source = value ?? ''
  const tokenPattern = /<[^>]*>|\[[^\]]+\]/g
  let result = ''
  let lastIndex = 0

  for (const match of source.matchAll(tokenPattern)) {
    const index = match.index ?? 0
    result += escapeGameNoticeHtml(source.slice(lastIndex, index)).replace(/\r?\n/g, '<br>')

    const token = match[0]
    const normalizedToken = token.toLowerCase().replace(/\s+/g, '')
    const colorMatch = token.match(/^\[color=(#[0-9a-f]{3}|#[0-9a-f]{6})\]$/i)
    const sizeMatch = token.match(/^\[size=(\d{1,3})\]$/i)
    const urlMatch = token.match(/^\[url=(.+)\]$/i)
    const color = colorMatch?.[1]
    const rawSize = sizeMatch?.[1]
    const rawUrl = urlMatch?.[1]

    if (normalizedToken === '<b>' || normalizedToken === '<strong>' || normalizedToken === '[b]') {
      result += '<strong class="font-semibold">'
    } else if (normalizedToken === '</b>' || normalizedToken === '</strong>' || normalizedToken === '[/b]') {
      result += '</strong>'
    } else if (normalizedToken === '<i>' || normalizedToken === '<em>') {
      result += '<em>'
    } else if (normalizedToken === '</i>' || normalizedToken === '</em>') {
      result += '</em>'
    } else if (normalizedToken === '<u>') {
      result += '<u>'
    } else if (normalizedToken === '</u>') {
      result += '</u>'
    } else if (/^<br\/?\s*>$/i.test(token)) {
      result += '<br>'
    } else if (color) {
      result += `<span style="color: ${color}">`
    } else if (/^\[\/color\]$/i.test(token)) {
      result += '</span>'
    } else if (rawSize) {
      const size = Math.min(Math.max(Number(rawSize), 10), 40)
      result += `<span style="font-size: ${size}px">`
    } else if (/^\[\/size\]$/i.test(token)) {
      result += '</span>'
    } else if (rawUrl) {
      const safeUrl = getSafeGameNoticeUrl(rawUrl)
      if (safeUrl) {
        result += `<a href="${escapeGameNoticeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="text-info underline-offset-2 hover:underline">`
      }
    } else if (/^\[\/url\]$/i.test(token)) {
      result += '</a>'
    }

    lastIndex = index + token.length
  }

  result += escapeGameNoticeHtml(source.slice(lastIndex)).replace(/\r?\n/g, '<br>')
  return result
}
