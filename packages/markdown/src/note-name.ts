import { frontMatterLines } from './front-matter-lines'

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

const FENCE = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/

const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

export function titleFrom(lines: Iterable<string>): string | null {
  const taken: string[] = []
  for (const line of lines) {
    taken.push(line)
    if (taken.length >= LINES) break
  }

  const matter = frontMatterLines(taken.join('\n'))
  const after = matter ? taken.join('\n').slice(0, matter.close).split('\n').length : 0
  let first: string | null = null

  let fence: string | null = null

  for (const raw of taken.slice(after)) {
    const line = raw.replace(/\r$/, '')
    const found = FENCE.exec(line)
    const mark = found ? (found[1] ?? found[2] ?? null) : null
    if (fence !== null) {
      const closes = mark?.startsWith(fence.slice(0, 3)) === true && mark.length >= fence.length
      if (closes && line.trim() === mark) fence = null
      continue
    }
    if (mark !== null) {
      fence = mark
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const words = (heading[2] ?? '').trim()
      if (words) return words
    }

    if (first === null && !RULE.test(line)) {
      const words = line.replace(MARKUP, '').trim()
      if (words) first = words
    }
  }

  return first
}

export function draftName(lines: Iterable<string>): string | null {
  const title = titleFrom(lines)
  if (title === null) return null

  const text = title.replace(/\s+/g, ' ').trim()
  return text ? Array.from(text).slice(0, MOST).join('') : null
}

export function nameFromContent(doc: string): string | null {
  const title = titleFrom(doc.split('\n'))
  return title === null ? null : nameFromTitle(title)
}

export function nameFromTitle(title: string): string | null {
  const text = title
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  const cut = Array.from(text)
    .slice(0, MOST)
    .join('')
    .replace(/[.\s]+$/, '')

  if (!cut) return null
  return isReserved(cut) ? `_${cut}` : cut
}
