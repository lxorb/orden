const RESERVED = [
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'CONIN$',
  'CONOUT$',
  ...Array.from('0123456789¹²³', (digit) => [`COM${digit}`, `LPT${digit}`]).flat(),
]

export function isReserved(name: string): boolean {
  const stem = (name.split('.')[0] ?? name).replace(/ +$/, '')
  return RESERVED.includes(stem.toUpperCase())
}

export const AGENTS_NAME = 'AGENTS.md'

export function isAgentsName(name: string): boolean {
  return /^agents\.(md|markdown|mdown|mkd)$/i.test(name.trim())
}

const OWN = /\.(md|markdown|mdown|mkd|canvas|pages|url|webloc|chat|base|term|application)$/i

export function shownName(name: string): string {
  return name.replace(OWN, '') || name
}

export function rowName(name: string, isFolder: boolean): string {
  return isFolder ? name : shownName(name)
}

export function endingOf(name: string): string | null {
  const own = OWN.exec(name)
  if (own) return own[0]

  const dot = name.lastIndexOf('.')
  return dot > 0 && /^[^\s.]+$/.test(name.slice(dot + 1)) ? name.slice(dot) : null
}

export function copyName(name: string): string {
  const ending = endingOf(name) ?? ''
  const stem = name.slice(0, name.length - ending.length)

  return stem ? `${stem} copy${ending}` : `copy${ending}`
}

const MOST = 60

const LINES = 40

export const TITLE_CHARS = 2_000

const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/

const MARKUP = /^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*)/

export function titleFrom(lines: Iterable<string>): string | null {
  let first: string | null = null
  let read = 0

  for (const line of lines) {
    const heading = HEADING.exec(line)
    if (heading) {
      const words = (heading[2] ?? '').trim()
      if (words) return words
    }

    if (first === null) {
      const words = line.replace(MARKUP, '').trim()
      if (words) first = words
    }

    if (++read >= LINES) break
  }

  return first
}

export function draftName(lines: Iterable<string>): string | null {
  const title = titleFrom(lines)
  if (title === null) return null

  const text = title.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, MOST) : null
}

export function nameFromContent(doc: string): string | null {
  const title = titleFrom(doc.split('\n'))
  return title === null ? null : nameFromTitle(title)
}

export function nameFromTitle(title: string): string | null {
  const text = title
    .replace(/[<>:"/\\|?* -]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, MOST)

  if (!text) return null
  return isReserved(text) ? `_${text}` : text
}
