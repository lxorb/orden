import type { Message, Who } from './types'

export type Has = 'link' | 'file' | 'image' | 'video' | 'voice' | 'poll' | 'pin' | 'reaction'

const HAS: readonly Has[] = ['link', 'file', 'image', 'video', 'voice', 'poll', 'pin', 'reaction']

export interface SearchQuery {
  words: string[]
  phrases: string[]
  without: string[]
  from: string[]
  in: string[]
  has: Has[]
  isReply: boolean
  mentions: string[]
  since?: string
  until?: string
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

const TOKEN = /([A-Za-z]+):"([^"]*)"?|(-?)"([^"]*)"?|(\S+)/g

export function parseSearch(query: string, today: string): SearchQuery {
  const out: SearchQuery = {
    words: [],
    phrases: [],
    without: [],
    from: [],
    in: [],
    has: [],
    isReply: false,
    mentions: [],
  }
  for (const match of query.matchAll(TOKEN)) {
    const [, quotedKey, quotedValue, minus, phrase, bare] = match
    if (quotedKey !== undefined && quotedValue !== undefined) {
      if (!modifier(out, quotedKey.toLowerCase(), quotedValue.trim(), today)) {
        out.phrases.push(`${quotedKey}:${quotedValue}`)
      }
    } else if (phrase !== undefined) {
      const words = phrase.trim()
      if (words) (minus ? out.without : out.phrases).push(words)
    } else if (bare !== undefined) {
      word(out, bare, today)
    }
  }
  return out
}

export function hasModifiers(query: SearchQuery): boolean {
  return (
    query.from.length > 0 ||
    query.in.length > 0 ||
    query.has.length > 0 ||
    query.isReply ||
    query.mentions.length > 0 ||
    query.since !== undefined ||
    query.until !== undefined
  )
}

function word(out: SearchQuery, token: string, today: string) {
  if (!/[\p{L}\p{N}]/u.test(token)) return
  if (token.length > 1 && token.startsWith('-')) {
    out.without.push(token.slice(1))
    return
  }
  const colon = token.indexOf(':')
  if (
    colon > 0 &&
    modifier(out, token.slice(0, colon).toLowerCase(), token.slice(colon + 1), today)
  )
    return
  out.words.push(token)
}

function modifier(out: SearchQuery, key: string, value: string, today: string): boolean {
  if (!value) return false
  switch (key) {
    case 'from':
      return named(out.from, value, '@')
    case 'in':
      return named(out.in, value, '#')
    case 'mentions':
      return named(out.mentions, value, '@')
    case 'has': {
      const has = HAS.find((one) => one === value.toLowerCase())
      if (has && !out.has.includes(has)) out.has.push(has)
      return has !== undefined
    }
    case 'is':
      if (value.toLowerCase() !== 'reply') return false
      out.isReply = true
      return true
    case 'before':
    case 'after':
    case 'on':
    case 'during': {
      const range = rangeOf(key, value.toLowerCase(), today)
      if (!range) return false
      if (range.since !== undefined && (out.since === undefined || range.since > out.since))
        out.since = range.since
      if (range.until !== undefined && (out.until === undefined || range.until < out.until))
        out.until = range.until
      return true
    }
    default:
      return false
  }
}

function named(list: string[], value: string, mark: string): boolean {
  const name = value.startsWith(mark) ? value.slice(mark.length).trim() : value
  if (!name) return false
  list.push(name)
  return true
}

function rangeOf(
  key: string,
  value: string,
  today: string,
): { since?: string; until?: string } | null {
  if (key === 'during') {
    const span = spanOf(value, today)
    return span && { since: span[0], until: span[1] }
  }
  const day = dayNamed(value, today)
  if (!day) return null
  if (key === 'before') return { until: day }
  if (key === 'after') return { since: plusDays(day, 1) }
  return { since: day, until: plusDays(day, 1) }
}

function dayNamed(value: string, today: string): string | null {
  if (value === 'today') return today
  if (value === 'yesterday') return plusDays(today, -1)
  return isDay(value) ? value : null
}

function spanOf(value: string, today: string): [string, string] | null {
  const day = dayNamed(value, today)
  if (day) return [day, plusDays(day, 1)]
  if (/^\d{4}$/.test(value)) return [`${value}-01-01`, `${String(Number(value) + 1)}-01-01`]

  const numbered = /^(\d{4})-(\d{2})$/.exec(value)
  if (numbered) {
    const month = Number(numbered[2])
    return month >= 1 && month <= 12 ? monthSpan(Number(numbered[1]), month) : null
  }

  const named = value.length >= 3 ? MONTHS.findIndex((month) => month.startsWith(value)) : -1
  if (named === -1) return null
  const [year, month] = today.split('-').map(Number)
  if (year === undefined || month === undefined) return null
  return monthSpan(named + 1 > month ? year - 1 : year, named + 1)
}

function monthSpan(year: number, month: number): [string, string] {
  const next = month === 12 ? [year + 1, 1] : [year, month + 1]
  return [dayText(year, month, 1), dayText(next[0] ?? year, next[1] ?? 1, 1)]
}

function isDay(value: string): boolean {
  const parts = DAY.exec(value)
  if (!parts) return false
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function plusDays(day: string, days: number): string {
  const parts = DAY.exec(day)
  if (!parts) return day
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + days))
  return dayText(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function dayText(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const LINK = /\bhttps?:\/\/\S/i

export function hasOf(message: Message): Has[] {
  if (message.deleted) return []
  const has: Has[] = []
  if (message.preview || LINK.test(message.body)) has.push('link')
  if (message.files.length > 0) has.push('file')
  if (message.files.some((file) => file.type.startsWith('image/'))) has.push('image')
  if (message.files.some((file) => file.type.startsWith('video/'))) has.push('video')
  if (message.files.some((file) => file.type.startsWith('audio/'))) has.push('voice')
  if (message.poll) has.push('poll')
  if (message.pinned) has.push('pin')
  if (Object.keys(message.reactions).length > 0) has.push('reaction')
  return has
}

export interface Hit {
  message: Message
  chat: string
  me: Who
  namesOf: (who: Who) => readonly string[]
  dayOf: (at: number) => string
}

export function matches(query: SearchQuery, hit: Hit): boolean {
  const { message } = hit
  if (message.deleted) return false

  const text = folded(message.body)
  const words = new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const has = (needle: string) => {
    const parts = folded(needle)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
    return parts.length > 0 && parts.every((part) => [...words].some((one) => one.startsWith(part)))
  }
  const says = (run: string) => text.includes(folded(run))

  if (!query.words.every(has) || !query.phrases.every(says)) return false
  if (query.without.some((one) => (one.includes(' ') ? says(one) : has(one)))) return false

  const isPerson = (name: string, who: Who) =>
    name.toLowerCase() === 'me'
      ? who === hit.me
      : hit.namesOf(who).some((one) => folded(one) === folded(name))
  if (query.from.length > 0 && !query.from.some((name) => isPerson(name, message.author)))
    return false
  if (query.in.length > 0 && !query.in.some((name) => folded(name) === folded(hit.chat)))
    return false
  if (query.mentions.length > 0) {
    const people = message.mentions.filter(
      (one): one is Who => one !== 'here' && one !== 'everyone',
    )
    if (!query.mentions.some((name) => people.some((who) => isPerson(name, who)))) return false
  }

  const hasNow = hasOf(message)
  if (!query.has.every((one) => hasNow.includes(one))) return false
  if (query.isReply && message.parent === undefined) return false

  const day = hit.dayOf(message.at)
  if (query.since !== undefined && day < query.since) return false
  return query.until === undefined || day < query.until
}

function folded(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}
