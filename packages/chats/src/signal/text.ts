export type Style = 'BOLD' | 'ITALIC' | 'SPOILER' | 'STRIKETHROUGH' | 'MONOSPACE'

export interface Span {
  start: number
  length: number
  style: Style
}

export interface Mentioned {
  start: number
  length: number
  uuid: string
}

export const PLACE = '￼'

const PAIRS: Record<Style, string> = {
  BOLD: '**',
  ITALIC: '_',
  STRIKETHROUGH: '~~',
  SPOILER: '||',
  MONOSPACE: '`',
}

const STYLES = new Set<string>(Object.keys(PAIRS))

export function isStyle(value: unknown): value is Style {
  return typeof value === 'string' && STYLES.has(value)
}

const SPECIAL = /[\\*_~`|[\]]/

interface Mark {
  at: number
  open: boolean
  text: string
  order: number
}

export function markdownOf(
  text: string,
  spans: readonly Span[],
  mentions: readonly Mentioned[] = [],
  nameOf: (uuid: string) => string = () => '',
): string {
  const marks: Mark[] = []
  const literal: [number, number][] = []
  spans.forEach((span, order) => {
    const end = span.start + span.length
    if (span.length <= 0 || span.start < 0 || end > text.length) return
    if (span.style === 'MONOSPACE') literal.push([span.start, end])
    const pair = PAIRS[span.style]
    marks.push({ at: span.start, open: true, text: pair, order })
    marks.push({ at: end, open: false, text: pair, order })
  })
  marks.sort((a, b) =>
    a.at !== b.at
      ? a.at - b.at
      : a.open !== b.open
        ? a.open
          ? 1
          : -1
        : a.open
          ? a.order - b.order
          : b.order - a.order,
  )
  const named = new Map<number, string>()
  for (const one of mentions) {
    if (text.charAt(one.start) !== PLACE) continue
    named.set(one.start, `@${nameOf(one.uuid) || 'someone'}`)
  }
  const inside = (at: number) => literal.some(([from, to]) => at >= from && at < to)
  let out = ''
  let next = 0
  const plain = (from: number, to: number) => {
    for (let at = from; at < to; at++) {
      const char = text.charAt(at)
      const name = named.get(at)
      if (name !== undefined) out += name
      else out += !inside(at) && SPECIAL.test(char) ? `\\${char}` : char
    }
  }
  for (const mark of marks) {
    plain(next, mark.at)
    next = Math.max(next, mark.at)
    out += mark.text
  }
  plain(next, text.length)
  return out
}

export interface Parsed {
  text: string
  spans: Span[]
}

const TOGGLES: [string, Style][] = [
  ['**', 'BOLD'],
  ['__', 'BOLD'],
  ['~~', 'STRIKETHROUGH'],
  ['||', 'SPOILER'],
  ['*', 'ITALIC'],
  ['_', 'ITALIC'],
]

const WORD = /[\p{L}\p{N}]/u

export function stylesOf(markdown: string): Parsed {
  let text = ''
  const spans: Span[] = []
  const open = new Map<string, number>()
  let at = 0
  while (at < markdown.length) {
    const char = markdown.charAt(at)
    if (char === '\\' && at + 1 < markdown.length && SPECIAL.test(markdown.charAt(at + 1))) {
      text += markdown.charAt(at + 1)
      at += 2
      continue
    }
    if (markdown.startsWith('```', at)) {
      const close = markdown.indexOf('```', at + 3)
      if (close !== -1) {
        let inner = markdown.slice(at + 3, close)
        const newline = inner.indexOf('\n')
        if (newline !== -1 && /^[\w+#.-]*$/.test(inner.slice(0, newline)))
          inner = inner.slice(newline + 1)
        if (inner.endsWith('\n')) inner = inner.slice(0, -1)
        spans.push({ start: text.length, length: inner.length, style: 'MONOSPACE' })
        text += inner
        at = close + 3
        continue
      }
    }
    if (char === '`') {
      const close = markdown.indexOf('`', at + 1)
      if (close > at + 1) {
        const inner = markdown.slice(at + 1, close)
        spans.push({ start: text.length, length: inner.length, style: 'MONOSPACE' })
        text += inner
        at = close + 1
        continue
      }
    }
    const toggle = TOGGLES.find(([marker]) => markdown.startsWith(marker, at))
    if (toggle) {
      const [marker, style] = toggle
      const before = markdown.charAt(at - 1)
      const after = markdown.charAt(at + marker.length)
      const started = open.get(marker)
      if (started !== undefined) {
        if (!/\s/.test(before) && !(marker === '_' && WORD.test(after))) {
          open.delete(marker)
          spans.push({ start: started, length: text.length - started, style })
          at += marker.length
          continue
        }
      } else if (
        after !== '' &&
        !/\s/.test(after) &&
        !(marker === '_' && WORD.test(before)) &&
        markdown.includes(marker, at + marker.length + (marker.length === 1 ? 1 : 0))
      ) {
        open.set(marker, text.length)
        at += marker.length
        continue
      }
    }
    text += char
    at++
  }
  if (open.size) return { text: markdown, spans: [] }
  return {
    text,
    spans: spans.filter((one) => one.length > 0).sort((a, b) => a.start - b.start),
  }
}

export function withMentions(
  parsed: Parsed,
  people: readonly { uuid: string; name: string }[],
): Parsed & { mentions: Mentioned[] } {
  let { text } = parsed
  let spans = [...parsed.spans]
  const mentions: Mentioned[] = []
  for (const person of people) {
    if (!person.name) continue
    const word = `@${person.name}`
    const at = text.indexOf(word)
    if (at === -1) continue
    const cut = word.length - 1
    text = text.slice(0, at) + PLACE + text.slice(at + word.length)
    spans = spans.map((one) => {
      if (one.start >= at + word.length) return { ...one, start: one.start - cut }
      if (one.start + one.length > at) return { ...one, length: Math.max(1, one.length - cut) }
      return one
    })
    for (const one of mentions) if (one.start > at) one.start -= cut
    mentions.push({ start: at, length: 1, uuid: person.uuid })
  }
  return { text, spans, mentions: mentions.sort((a, b) => a.start - b.start) }
}
