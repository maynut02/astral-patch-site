export type ReleaseMarkdownInlineNode
  = | { type: 'text', text: string }
    | { type: 'image', src: string, alt: string }
    | { type: 'strong' | 'emphasis' | 'delete', children: ReleaseMarkdownInlineNode[] }
    | { type: 'code', text: string }
    | { type: 'link', href: string, children: ReleaseMarkdownInlineNode[] }

export interface ReleaseMarkdownListItem {
  checked: boolean | null
  children: ReleaseMarkdownInlineNode[]
}

export type ReleaseMarkdownBlock
  = | { type: 'heading', level: number, children: ReleaseMarkdownInlineNode[] }
    | { type: 'paragraph', children: ReleaseMarkdownInlineNode[] }
    | { type: 'blockquote', children: ReleaseMarkdownInlineNode[] }
    | { type: 'code', language: string, text: string }
    | { type: 'list', ordered: boolean, items: ReleaseMarkdownListItem[] }
    | { type: 'table', headers: ReleaseMarkdownInlineNode[][], rows: ReleaseMarkdownInlineNode[][][] }
    | { type: 'hr' }

function isSafeHref(value: string): boolean {
  const href = value.trim()
  if (!href) {
    return false
  }

  if (href.startsWith('#') || href.startsWith('/')) {
    return true
  }

  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function resolveMarkdownHref(value: string, baseUrl?: string, image = false): string | null {
  let href = value.trim()
  if (!href) return null

  if (baseUrl) {
    try {
      href = new URL(href, baseUrl).href
    } catch {
      return null
    }
  }

  if (!isSafeHref(href) || (image && !/^https?:\/\//i.test(href) && !href.startsWith('/'))) return null
  return href
}

function gitHubReleaseCommitBaseUrl(baseUrl?: string): string | null {
  if (!baseUrl) return null

  try {
    const url = new URL(baseUrl)
    const repository = url.pathname.match(/^\/([^/]+\/[^/]+)\/releases(?:\/|$)/)?.[1]
    return url.origin === 'https://github.com' && !url.username && !url.password && repository
      ? `${url.origin}/${repository}/commit/`
      : null
  } catch {
    return null
  }
}

function findClosingMarker(text: string, marker: string, start: number): number {
  let index = start
  while (index < text.length) {
    const found = text.indexOf(marker, index)
    if (found === -1) {
      return -1
    }

    if (found === 0 || text[found - 1] !== '\\') {
      return found
    }
    index = found + marker.length
  }
  return -1
}

function findClosingDelimiter(text: string, opening: '[' | '(', start: number): number {
  const closing = opening === '[' ? ']' : ')'
  let depth = 1

  for (let index = start; index < text.length; index++) {
    if (text[index] === '\\') {
      index++
      continue
    }

    // Brackets in code labels are literal, and must not close the surrounding link.
    if (opening === '[' && text[index] === '`') {
      const marker = text.slice(index).match(/^`+/)?.[0] ?? '`'
      const end = findClosingMarker(text, marker, index + marker.length)
      if (end !== -1) {
        index = end + marker.length - 1
        continue
      }
    }

    if (text[index] === opening) depth++
    else if (text[index] === closing && --depth === 0) return index
  }
  return -1
}

function pushText(nodes: ReleaseMarkdownInlineNode[], text: string): void {
  if (!text) {
    return
  }

  const previous = nodes[nodes.length - 1]
  if (previous?.type === 'text') {
    previous.text += text
  } else {
    nodes.push({ type: 'text', text })
  }
}

export function parseReleaseMarkdownInline(text: string, baseUrl?: string, imageBaseUrl = baseUrl, insideLink = false): ReleaseMarkdownInlineNode[] {
  const nodes: ReleaseMarkdownInlineNode[] = []
  const commitBaseUrl = insideLink ? null : gitHubReleaseCommitBaseUrl(baseUrl)
  let index = 0
  let plainStart = 0

  const flushPlain = (end: number) => {
    pushText(nodes, text.slice(plainStart, end).replace(/\\(.)/g, (match, char: string) =>
      '\\`*_{}[]()#+-.!~>'.includes(char) ? char : match))
  }

  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) {
      index += 2
      continue
    }

    if (text[index] === '`') {
      const end = findClosingMarker(text, '`', index + 1)
      if (end !== -1) {
        flushPlain(index)
        nodes.push({ type: 'code', text: text.slice(index + 1, end) })
        index = end + 1
        plainStart = index
        continue
      }
    }

    // Some GitHub release bodies contain only a parenthesized hash, without link syntax.
    if (commitBaseUrl && text[index] === '(' && text[index - 1] !== '\\') {
      const hash = text.slice(index).match(/^\(([0-9a-f]{7,40})\)/i)?.[1]
      if (hash) {
        flushPlain(index + 1)
        nodes.push({ type: 'link', href: `${commitBaseUrl}${hash}`, children: [{ type: 'text', text: hash }] })
        index += hash.length + 1
        plainStart = index
        continue
      }
    }

    const strongMarker = text.startsWith('**', index) ? '**' : text.startsWith('__', index) ? '__' : ''
    if (strongMarker) {
      const end = findClosingMarker(text, strongMarker, index + 2)
      if (end !== -1) {
        flushPlain(index)
        nodes.push({
          type: 'strong',
          children: parseReleaseMarkdownInline(text.slice(index + 2, end), baseUrl, imageBaseUrl, insideLink)
        })
        index = end + 2
        plainStart = index
        continue
      }
    }

    if (text.startsWith('~~', index)) {
      const end = findClosingMarker(text, '~~', index + 2)
      if (end !== -1) {
        flushPlain(index)
        nodes.push({
          type: 'delete',
          children: parseReleaseMarkdownInline(text.slice(index + 2, end), baseUrl, imageBaseUrl, insideLink)
        })
        index = end + 2
        plainStart = index
        continue
      }
    }

    const emphasisMarker = text[index] === '*' || text[index] === '_' ? text[index] : ''
    if (emphasisMarker) {
      const end = findClosingMarker(text, emphasisMarker, index + 1)
      if (end !== -1 && end > index + 1) {
        flushPlain(index)
        nodes.push({
          type: 'emphasis',
          children: parseReleaseMarkdownInline(text.slice(index + 1, end), baseUrl, imageBaseUrl, insideLink)
        })
        index = end + 1
        plainStart = index
        continue
      }
    }

    if (text[index] === '!' && text[index + 1] === '[') {
      const labelEnd = findClosingDelimiter(text, '[', index + 2)
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const hrefEnd = findClosingDelimiter(text, '(', labelEnd + 2)
        if (hrefEnd !== -1) {
          const src = resolveMarkdownHref(text.slice(labelEnd + 2, hrefEnd).trim().split(/\s+/)[0] ?? '', imageBaseUrl, true)
          flushPlain(index)
          if (src) {
            nodes.push({ type: 'image', src, alt: text.slice(index + 2, labelEnd) })
          } else {
            pushText(nodes, text.slice(index, hrefEnd + 1))
          }
          index = hrefEnd + 1
          plainStart = index
          continue
        }
      }
    }

    if (!insideLink && text[index] === '[') {
      const labelEnd = findClosingDelimiter(text, '[', index + 1)
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const hrefEnd = findClosingDelimiter(text, '(', labelEnd + 2)
        if (hrefEnd !== -1) {
          const href = resolveMarkdownHref(text.slice(labelEnd + 2, hrefEnd).trim().split(/\s+/)[0] ?? '', baseUrl)
          if (href) {
            flushPlain(index)
            nodes.push({
              type: 'link',
              href,
              children: parseReleaseMarkdownInline(text.slice(index + 1, labelEnd), baseUrl, imageBaseUrl, true)
            })
            index = hrefEnd + 1
            plainStart = index
            continue
          }
        }
      }
    }

    if (!insideLink && text[index] === '<') {
      const end = text.indexOf('>', index + 1)
      if (end !== -1) {
        const href = text.slice(index + 1, end).trim()
        if (isSafeHref(href)) {
          flushPlain(index)
          nodes.push({
            type: 'link',
            href,
            children: [{ type: 'text', text: href }]
          })
          index = end + 1
          plainStart = index
          continue
        }
      }
    }

    if (!insideLink && (text.startsWith('http://', index) || text.startsWith('https://', index))) {
      const match = text.slice(index).match(/^https?:\/\/[^\s<]+/)
      const rawHref = match?.[0] ?? ''
      const href = rawHref.replace(/[),.;!?]+$/, '')
      if (href && isSafeHref(href)) {
        flushPlain(index)
        nodes.push({
          type: 'link',
          href,
          children: [{ type: 'text', text: href }]
        })
        index += href.length
        plainStart = index
        continue
      }
    }

    index += 1
  }

  flushPlain(text.length)
  return nodes
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let escaped = false

  for (const char of trimmed) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function startsBlock(line: string, nextLine = ''): boolean {
  return /^\s*$/.test(line)
    || /^ {0,3}#{1,6}\s+/.test(line)
    || /^ {0,3}```/.test(line)
    || /^ {0,3}>\s?/.test(line)
    || /^\s*([-+*])\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)
    || (line.includes('|') && isTableSeparator(nextLine))
}

export function parseReleaseMarkdown(source: string, baseUrl?: string, imageBaseUrl = baseUrl): ReleaseMarkdownBlock[] {
  const inline = (text: string) => parseReleaseMarkdownInline(text, baseUrl, imageBaseUrl)
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReleaseMarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const nextLine = lines[index + 1] ?? ''

    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^ {0,3}```\s*([^`]*)$/)
    if (fence) {
      const language = fence[1]?.trim() ?? ''
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({ type: 'code', language, text: codeLines.join('\n') })
      continue
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]?.length ?? 1,
        children: inline(heading[2] ?? '')
      })
      index += 1
      continue
    }

    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }

    if (line.includes('|') && isTableSeparator(nextLine)) {
      const headers = splitTableRow(line).map(inline)
      const rows: ReleaseMarkdownInlineNode[][][] = []
      index += 2
      while (index < lines.length) {
        const row = lines[index] ?? ''
        if (!row.trim() || !row.includes('|')) {
          break
        }
        rows.push(splitTableRow(row).map(inline))
        index += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    if (/^ {0,3}>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^ {0,3}>\s?/.test(lines[index] ?? '')) {
        quoteLines.push((lines[index] ?? '').replace(/^ {0,3}>\s?/, ''))
        index += 1
      }
      blocks.push({
        type: 'blockquote',
        children: inline(quoteLines.join(' '))
      })
      continue
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered)
      const items: ReleaseMarkdownListItem[] = []
      const pattern = isOrdered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/

      while (index < lines.length) {
        const itemMatch = (lines[index] ?? '').match(pattern)
        if (!itemMatch) {
          break
        }

        let content = itemMatch[1] ?? ''
        let checked: boolean | null = null
        const task = content.match(/^\[([ xX])\]\s+(.*)$/)
        if (task) {
          checked = task[1]?.toLowerCase() === 'x'
          content = task[2] ?? ''
        }

        items.push({
          checked,
          children: inline(content)
        })
        index += 1
      }

      blocks.push({ type: 'list', ordered: isOrdered, items })
      continue
    }

    const paragraphLines = [line.trim()]
    index += 1
    while (index < lines.length) {
      const candidate = lines[index] ?? ''
      const candidateNext = lines[index + 1] ?? ''
      if (startsBlock(candidate, candidateNext)) {
        break
      }
      paragraphLines.push(candidate.trim())
      index += 1
    }

    blocks.push({
      type: 'paragraph',
      children: inline(paragraphLines.join(' '))
    })
  }

  return blocks
}
