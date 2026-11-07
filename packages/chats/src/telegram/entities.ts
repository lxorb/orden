import type { tl } from '@mtcute/core'

type Entity = tl.TypeMessageEntity

interface Mark {
  at: number
  open: boolean
  text: string
  order: number
}

const LITERAL = new Set([
  'messageEntityCode',
  'messageEntityPre',
  'messageEntityUrl',
  'messageEntityEmail',
  'messageEntityMention',
  'messageEntityHashtag',
  'messageEntityCashtag',
  'messageEntityBotCommand',
  'messageEntityTextUrl',
])

const SPECIAL = /[\\*_~`[\]|]/

const PAIRS: Partial<Record<Entity['_'], [string, string]>> = {
  messageEntityBold: ['**', '**'],
  messageEntityItalic: ['_', '_'],
  messageEntityStrike: ['~~', '~~'],
  messageEntitySpoiler: ['||', '||'],
  messageEntityCode: ['`', '`'],
}

function wraps(entity: Entity): [string, string] | null {
  if (entity._ === 'messageEntityPre') return ['```' + entity.language + '\n', '\n```']
  if (entity._ === 'messageEntityTextUrl') return ['[', `](${entity.url})`]
  return PAIRS[entity._] ?? null
}

export function markdownOf(text: string, entities: readonly Entity[] = []): string {
  const marks: Mark[] = []
  const literal: [number, number][] = []
  const quotes: [number, number][] = []
  entities.forEach((entity, order) => {
    const end = entity.offset + entity.length
    if (LITERAL.has(entity._)) literal.push([entity.offset, end])
    if (entity._ === 'messageEntityBlockquote') {
      quotes.push([entity.offset, end])
      return
    }
    if (entity._ === 'messageEntityMentionName' && text.charAt(entity.offset) !== '@') {
      marks.push({ at: entity.offset, open: true, text: '@', order })
      return
    }
    const pair = wraps(entity)
    if (!pair) return
    marks.push({ at: entity.offset, open: true, text: pair[0], order })
    marks.push({ at: end, open: false, text: pair[1], order })
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
  const inside = (at: number, spans: [number, number][]) =>
    spans.some(([from, to]) => at >= from && at < to)
  const prefixed = new Set<number>()
  let out = ''
  const prefix = (at: number) => {
    if (prefixed.has(at) || !inside(at, quotes)) return
    if (at !== 0 && text.charAt(at - 1) !== '\n') return
    prefixed.add(at)
    out += '> '
  }
  let next = 0
  const plain = (from: number, to: number) => {
    for (let at = from; at < to; at++) {
      const char = text.charAt(at)
      prefix(at)
      out += !inside(at, literal) && SPECIAL.test(char) ? `\\${char}` : char
    }
  }
  for (const mark of marks) {
    plain(next, mark.at)
    next = Math.max(next, mark.at)
    if (mark.open) prefix(mark.at)
    out += mark.text
  }
  plain(next, text.length)
  return out
}

interface Parsed {
  text: string
  entities: Entity[]
}

const TOGGLES: [string, Entity['_']][] = [
  ['**', 'messageEntityBold'],
  ['__', 'messageEntityBold'],
  ['~~', 'messageEntityStrike'],
  ['||', 'messageEntitySpoiler'],
  ['*', 'messageEntityItalic'],
  ['_', 'messageEntityItalic'],
]

const WORD = /[\p{L}\p{N}]/u

function span(kind: Entity['_'], offset: number, length: number): Entity {
  return { _: kind, offset, length } as Entity
}

export function entitiesOf(markdown: string): Parsed {
  const lines = markdown.split('\n')
  const quoted: { text: string; quote: boolean }[] = lines.map((line) =>
    line.startsWith('> ') || line === '>'
      ? { text: line.slice(2), quote: true }
      : { text: line, quote: false },
  )
  const body = quoted.map((one) => one.text).join('\n')
  const parsed = inline(body)
  const map = (at: number) => at - parsed.removed.filter((one) => one < at).length
  let lineStart = 0
  let quoteFrom: number | null = null
  const quotes: Entity[] = []
  quoted.forEach((line, index) => {
    const start = map(lineStart)
    if (line.quote && quoteFrom === null) quoteFrom = start
    if (!line.quote && quoteFrom !== null) {
      quotes.push(span('messageEntityBlockquote', quoteFrom, Math.max(0, start - 1 - quoteFrom)))
      quoteFrom = null
    }
    lineStart += line.text.length + 1
    if (index === quoted.length - 1 && quoteFrom !== null)
      quotes.push(span('messageEntityBlockquote', quoteFrom, parsed.text.length - quoteFrom))
  })
  return {
    text: parsed.text,
    entities: [...quotes, ...parsed.entities].filter((one) => one.length > 0),
  }
}

function inline(source: string): Parsed & { removed: number[] } {
  let text = ''
  const entities: Entity[] = []
  const removed: number[] = []
  const open = new Map<string, number>()
  const drop = (from: number, count: number) => {
    for (let at = from; at < from + count; at++) removed.push(at)
  }
  let at = 0
  while (at < source.length) {
    const char = source.charAt(at)
    if (char === '\\' && at + 1 < source.length && /[\\*_~`[\]|>()]/.test(source.charAt(at + 1))) {
      drop(at, 1)
      text += source.charAt(at + 1)
      at += 2
      continue
    }
    if (source.startsWith('```', at)) {
      const close = source.indexOf('```', at + 3)
      if (close !== -1) {
        let inner = source.slice(at + 3, close)
        let language = ''
        const newline = inner.indexOf('\n')
        if (newline !== -1 && /^[\w+#.-]*$/.test(inner.slice(0, newline))) {
          language = inner.slice(0, newline)
          inner = inner.slice(newline + 1)
          drop(at, 3 + newline + 1)
        } else drop(at, 3)
        if (inner.endsWith('\n')) {
          inner = inner.slice(0, -1)
          drop(close - 1, 1)
        }
        drop(close, 3)
        entities.push({
          _: 'messageEntityPre',
          offset: text.length,
          length: inner.length,
          language,
        })
        text += inner
        at = close + 3
        continue
      }
    }
    if (char === '`') {
      const close = source.indexOf('`', at + 1)
      if (close > at + 1) {
        const inner = source.slice(at + 1, close)
        drop(at, 1)
        drop(close, 1)
        entities.push(span('messageEntityCode', text.length, inner.length))
        text += inner
        at = close + 1
        continue
      }
    }
    if (char === '[') {
      const middle = source.indexOf('](', at + 1)
      const close = middle === -1 ? -1 : source.indexOf(')', middle + 2)
      if (middle !== -1 && close !== -1 && !source.slice(at + 1, middle).includes('\n')) {
        const url = source.slice(middle + 2, close)
        const inner = inline(source.slice(at + 1, middle))
        const offset = text.length
        drop(at, 1)
        for (const one of inner.removed) removed.push(at + 1 + one)
        for (let gone = middle; gone <= close; gone++) removed.push(gone)
        for (const entity of inner.entities)
          entities.push({ ...entity, offset: entity.offset + offset })
        entities.push({ _: 'messageEntityTextUrl', offset, length: inner.text.length, url })
        text += inner.text
        at = close + 1
        continue
      }
    }
    const toggle = TOGGLES.find(([marker]) => source.startsWith(marker, at))
    if (toggle) {
      const [marker, kind] = toggle
      const before = source.charAt(at - 1)
      const after = source.charAt(at + marker.length)
      const started = open.get(marker)
      const single = marker.length === 1
      if (started !== undefined) {
        const closes = !/\s/.test(before) && !(marker === '_' && WORD.test(after))
        if (closes) {
          open.delete(marker)
          drop(at, marker.length)
          entities.push(span(kind, started, text.length - started))
          at += marker.length
          continue
        }
      } else {
        const opens =
          after !== '' &&
          !/\s/.test(after) &&
          !(marker === '_' && WORD.test(before)) &&
          source.includes(marker, at + marker.length + (single ? 1 : 0))
        if (opens) {
          open.set(marker, text.length)
          drop(at, marker.length)
          at += marker.length
          continue
        }
      }
    }
    text += char
    at++
  }
  if (open.size) return literal(source)
  return { text, entities: entities.sort((a, b) => a.offset - b.offset), removed }
}

function literal(source: string): Parsed & { removed: number[] } {
  return { text: source, entities: [], removed: [] }
}

export function withMentions(
  parsed: Parsed,
  people: readonly { name: string; handle?: string; user: tl.TypeInputUser }[],
): Parsed {
  let { text } = parsed
  let entities = [...parsed.entities]
  for (const person of people) {
    if (person.handle && text.includes(`@${person.handle}`)) continue
    const at = text.indexOf(`@${person.name}`)
    if (at === -1) continue
    text = text.slice(0, at) + text.slice(at + 1)
    entities = entities.map((one) => {
      if (one.offset > at) return { ...one, offset: one.offset - 1 }
      if (one.offset + one.length > at) return { ...one, length: one.length - 1 }
      return one
    })
    entities.push({
      _: 'inputMessageEntityMentionName',
      offset: at,
      length: person.name.length,
      userId: person.user,
    })
  }
  return { text, entities: entities.sort((a, b) => a.offset - b.offset) }
}
