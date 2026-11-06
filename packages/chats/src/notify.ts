import { MENTIONS_ONLY_PAST } from './limits'
import type { Mention, Notify, Who } from './types'

export interface Hours {
  days: number[]
  from: number
  to: number
}

export interface Hush {
  keywords: readonly string[]
  hours: Hours | null
  dndUntil: number | null
}

export interface Heard {
  author: Who
  body: string
  mentions: readonly Mention[]
  repliesTo?: Who | null
}

export interface Hearing {
  notify: Notify | null
  mutedUntil: number | null
  members: number
}

export interface Moment {
  now: number
  day: number
  minute: number
}

export interface Asked {
  me: Who
  message: Heard
  chat: Hearing
  hush: Hush
  moment: Moment
  active: boolean
  seen: boolean
}

export type Ping = 'show' | 'own' | 'seen' | 'muted' | 'level' | 'dnd' | 'hours'

export type Call = 'name' | 'everyone' | 'here' | 'reply' | 'keyword'

export const MOST_KEYWORDS = 50
export const LONGEST_KEYWORD = 60

export const MUTED_FOR_GOOD = Number.MAX_SAFE_INTEGER

export const DESKTOP_ACTIVE_WITHIN = 2 * 60 * 1000

const DAY_MINUTES = 24 * 60

export function levelOf(notify: Notify | null, members: number): Notify {
  return notify ?? (members > MENTIONS_ONLY_PAST ? 'mentions' : 'all')
}

export function isMuted(mutedUntil: number | null, now: number): boolean {
  return mutedUntil !== null && mutedUntil > now
}

const WORDY = '[\\p{L}\\p{N}_]'

export function keywordIn(body: string, keywords: readonly string[]): string | null {
  const text = body.normalize('NFC')
  for (const keyword of keywords) {
    const clean = keyword.trim().normalize('NFC')
    if (!clean) continue
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?<!${WORDY})${escaped}(?!${WORDY})`, 'iu').test(text)) return keyword
  }
  return null
}

export function callOf(
  message: Heard,
  me: Who,
  active: boolean,
  keywords: readonly string[],
): Call | null {
  if (message.mentions.includes(me)) return 'name'
  if (message.mentions.includes('everyone')) return 'everyone'
  if (active && message.mentions.includes('here')) return 'here'
  if (message.repliesTo === me) return 'reply'
  return keywordIn(message.body, keywords) === null ? null : 'keyword'
}

export function inHours(hours: Hours | null, moment: Moment): boolean {
  if (!hours) return true
  const { days, from, to } = hours
  if (from === to) return days.includes(moment.day)
  if (from < to) return days.includes(moment.day) && moment.minute >= from && moment.minute < to
  const yesterday = (moment.day + 6) % 7
  return (
    (days.includes(moment.day) && moment.minute >= from) ||
    (days.includes(yesterday) && moment.minute < to)
  )
}

export function decide(asked: Asked): Ping {
  const { me, message, chat, hush, moment } = asked
  if (message.author === me) return 'own'
  if (asked.seen) return 'seen'
  if (isMuted(chat.mutedUntil, moment.now)) return 'muted'

  const level = levelOf(chat.notify, chat.members)
  if (level === 'nothing') return 'level'
  if (level === 'mentions' && callOf(message, me, asked.active, hush.keywords) === null)
    return 'level'

  if (hush.dndUntil !== null && hush.dndUntil > moment.now) return 'dnd'
  return inHours(hush.hours, moment) ? 'show' : 'hours'
}

export function owesPush(ping: Ping, desktopActive: boolean): boolean {
  return ping === 'show' && !desktopActive
}

export function isKeywords(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MOST_KEYWORDS &&
    value.every(
      (one) => typeof one === 'string' && one.trim().length > 0 && one.length <= LONGEST_KEYWORD,
    )
  )
}

export function isHours(value: unknown): value is Hours {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { days, from, to } = value as Record<string, unknown>
  const minute = (one: unknown) =>
    typeof one === 'number' && Number.isInteger(one) && one >= 0 && one < DAY_MINUTES
  return (
    Array.isArray(days) &&
    days.every((one) => typeof one === 'number' && Number.isInteger(one) && one >= 0 && one <= 6) &&
    new Set(days).size === days.length &&
    minute(from) &&
    minute(to)
  )
}
