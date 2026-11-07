const FENCE = /^ {0,3}(`{3,}(?!.*`)|~{3,})[ \t]*(\S*)/

function couldBeFence(line: string): boolean {
  let at = 0
  while (at < 3 && line[at] === ' ') at++

  const mark = line[at]
  return mark === '`' || mark === '~'
}

export function fenceMark(line: string): string | null {
  if (!couldBeFence(line)) return null
  return FENCE.exec(line)?.[1] ?? null
}

export function closesFence(line: string, mark: string): boolean {
  if (!couldBeFence(line)) return false

  const found = FENCE.exec(line)
  if (!found) return false

  const run = found[1] ?? ''
  if (!run.startsWith(mark.charAt(0)) || run.length < mark.length) return false
  return /^ {0,3}[`~]+[ \t]*\r?$/.test(line) || fenceName(line) !== null
}

export function fenceName(line: string): string | null {
  if (!couldBeFence(line)) return null
  return /^ {0,3}(?:`{3,}|~{3,})[ \t]+\^([A-Za-z0-9-]+)[ \t]*\r?$/.exec(line)?.[1] ?? null
}

export function closingTicks(line: string, from: number, length: number): number {
  const run = new RegExp(`(?<!\`)\`{${length}}(?!\`)`, 'g')
  run.lastIndex = from
  return run.exec(line)?.index ?? -1
}

export const WORDS = 0
export const CODE = 1
export const OPENS = 2

export type CodeLine = typeof WORDS | typeof CODE | typeof OPENS

type Container = { quote: true } | { quote: false; width: number }

type Leaf = null | 'paragraph' | 'indented' | { mark: string }

const MARKER = /^([-*+]|(\d{1,9})[.)])( *)(.?)/

const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/

const NEST_DEEPEST = 100

function expanded(line: string): string {
  if (!line.includes('\t')) return line

  let out = ''
  for (const one of line) out += one === '\t' ? ' '.repeat(4 - (out.length % 4)) : one
  return out
}

function spacesAt(line: string, at: number): number {
  let over = 0
  while (line.charAt(at + over) === ' ') over++
  return over
}

export class CodeBlocks {
  private containers: Container[] = []
  private leaf: Leaf = null
  private item = false
  private named: string | null = null

  copy(): CodeBlocks {
    const copy = new CodeBlocks()
    copy.containers = [...this.containers]
    copy.leaf = this.leaf
    return copy
  }

  get openedItem(): boolean {
    return this.item
  }

  get closedName(): string | null {
    return this.named
  }

  get fence(): string | null {
    return this.leaf !== null && typeof this.leaf === 'object' ? this.leaf.mark : null
  }

  line(raw: string): CodeLine {
    const line = expanded(raw.endsWith('\r') ? raw.slice(0, -1) : raw)
    this.item = false
    this.named = null
    let at = 0
    let matched = 0

    for (const container of this.containers) {
      const indent = spacesAt(line, at)
      if (container.quote) {
        if (indent > 3 || line.charAt(at + indent) !== '>') break
        at += indent + 1
        if (line.charAt(at) === ' ') at++
      } else if (line.slice(at).trim() === '') {
        at = line.length
      } else if (indent >= container.width) {
        at += container.width
      } else {
        break
      }
      matched++
    }

    const rest = line.slice(at)

    if (matched < this.containers.length) {
      if (this.leaf === 'paragraph' && rest.trim() !== '' && !this.opensBlock(rest)) return WORDS
      this.containers.length = matched
      this.leaf = null
    }

    if (this.leaf !== null && typeof this.leaf === 'object') {
      if (closesFence(rest, this.leaf.mark)) {
        this.leaf = null
        this.named = fenceName(rest)
      }
      return CODE
    }

    if (this.leaf === 'indented') {
      if (rest.trim() === '' || spacesAt(rest, 0) >= 4) return CODE
      this.leaf = null
    }

    return this.open(rest)
  }

  private opensBlock(rest: string): boolean {
    const indent = spacesAt(rest, 0)
    if (indent > 3) return false

    const text = rest.slice(indent)
    return (
      text.startsWith('>') ||
      fenceMark(rest) !== null ||
      HEADING.test(rest) ||
      BREAK.test(rest) ||
      this.marker(text, false) !== null
    )
  }

  private marker(text: string, interrupting: boolean): number | null {
    const found = MARKER.exec(text)
    if (!found) return null

    const [, mark = '', number, spaces = '', next = ''] = found
    if (spaces === '' && next !== '') return null
    if (interrupting && (next === '' || (number !== undefined && Number(number) !== 1))) return null

    if (next === '' || spaces.length > 4) return mark.length + 1
    return mark.length + spaces.length
  }

  private open(start: string): CodeLine {
    let rest = start

    while (this.containers.length < NEST_DEEPEST) {
      const indent = spacesAt(rest, 0)
      if (indent > 3) break
      const text = rest.slice(indent)

      if (text.startsWith('>')) {
        this.containers.push({ quote: true })
        this.leaf = null
        rest = text.slice(text.charAt(1) === ' ' ? 2 : 1)
        continue
      }

      if (BREAK.test(rest)) break
      const width = this.marker(text, this.leaf === 'paragraph')
      if (width === null) break

      this.containers.push({ quote: false, width: indent + width })
      this.item = true
      this.leaf = null
      rest = text.length > width ? text.slice(width) : ''
    }

    if (rest.trim() === '') {
      this.leaf = null
      return WORDS
    }

    if (spacesAt(rest, 0) >= 4) {
      if (this.leaf === 'paragraph') return WORDS
      this.leaf = 'indented'
      return CODE
    }

    const mark = fenceMark(rest)
    if (mark !== null) {
      this.leaf = { mark }
      return OPENS
    }

    this.leaf = HEADING.test(rest) || BREAK.test(rest) ? null : 'paragraph'
    return WORDS
  }
}
