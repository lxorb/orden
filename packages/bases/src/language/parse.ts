import { TAG_NAME } from '@orden/markdown/tags'
import { tagsIn } from '@orden/markdown/task-line'
import type { Priority, Remind } from '@orden/markdown/task-line'
import { addDays } from '../dates'
import { nextDate, ruleText } from '../recurrence'
import { DE } from './de'
import { EN, EN_US } from './en'
import type { Grammar } from './grammar'
import { repeatAt } from './repeat'
import { type Clock, clockOf, dayAt, timeAt, whenAt } from './when'
import { bare, type Word, wordsOf } from './words'

export type ChipKind =
  'when' | 'repeat' | 'priority' | 'tag' | 'assignee' | 'remind' | 'deadline' | 'duration'

export interface Chip {
  kind: ChipKind
  from: number
  to: number
}

export interface QuickFields {
  due?: string
  time?: string
  recurrence?: string
  priority?: Priority
  tags: string[]
  assignee?: string
  remind: Remind[]
  deadline?: string
  duration?: number
}

export interface QuickAdd {
  text: string
  fields: QuickFields
  chips: Chip[]
}

export interface QuickAddOptions {
  keep?: readonly { from: number; to: number }[]
  escaped?: readonly { from: number; to: number }[]
}

const GRAMMARS: Record<string, Grammar> = { en: EN, 'en-us': EN_US, de: DE }

function grammarsFor(langs: readonly string[]): Grammar[] {
  const out: Grammar[] = []
  for (const lang of [...langs, 'en']) {
    const lower = lang.toLowerCase()
    const found = GRAMMARS[lower] ?? GRAMMARS[lower.split('-')[0] ?? '']
    if (found && !out.some((one) => one.lang.startsWith(found.lang.slice(0, 2)))) out.push(found)
  }
  return out
}

interface Found {
  kind: ChipKind
  at: number
  end: number
  slots?: readonly string[]
  apply(into: QuickAdd): void
}

const TAG = new RegExp(String.raw`^[#@%](${TAG_NAME})$`, 'u')
const PERSON = /^\+([\p{L}][\p{L}\p{N}\-_.]*)$/u
const PRIORITY = /^p([1-4])$/i

function remindAt(words: readonly Word[], at: number, g: Grammar, clock: Clock): Found | null {
  const first = words[at]
  if (!first?.key.startsWith('!') || first.key.length < 2) return null

  const before = /^!(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)(?:m|min))?$/.exec(first.key)
  if (before && (before[1] ?? before[2] ?? before[3]) !== undefined) {
    const minutes =
      Number(before[1] ?? 0) * 1440 + Number(before[2] ?? 0) * 60 + Number(before[3] ?? 0)
    return {
      kind: 'remind',
      at,
      end: at + 1,
      apply: (into) => into.fields.remind.push({ before: minutes }),
    }
  }

  const shown = [
    { ...first, raw: first.raw.slice(1), key: first.key.slice(1) },
    ...words.slice(at + 1),
  ]
  const when = whenAt(shown, 0, g, clock, true) ?? timeAt(shown, 0, g, true)
  if (!when) return null
  const end = at + when.end
  return {
    kind: 'remind',
    at,
    end,
    apply(into) {
      if (when.day && when.time) into.fields.remind.push({ at: when.day, time: when.time })
      else if (when.time) into.fields.remind.push({ time: when.time })
      else if (when.day) into.fields.remind.push({ at: when.day, time: '09:00' })
    },
  }
}

function deadlineAt(words: readonly Word[], at: number, g: Grammar, clock: Clock): Found | null {
  const first = words[at]
  if (!first?.raw.startsWith('{')) return null
  let close = at
  while (close < words.length && !(words[close]?.raw.endsWith('}') ?? false)) close++
  if (close >= words.length || close - at > 5) return null

  const inner = words.slice(at, close + 1).map((word, index, all) => {
    let raw = word.raw
    if (index === 0) raw = raw.slice(1)
    if (index === all.length - 1) raw = raw.slice(0, -1)
    return { ...word, raw, key: raw.toLowerCase().replace(/[,;]+$/u, '') }
  })
  const day = dayAt(inner, 0, g, clock, true)
  if (!day?.day || day.end !== inner.length) return null
  const date = day.day
  return { kind: 'deadline', at, end: close + 1, apply: (into) => (into.fields.deadline = date) }
}

function durationAt(words: readonly Word[], at: number, g: Grammar): Found | null {
  const lead = g.lasting.has(bare(words[at])) ? 1 : 0
  if (!lead && !g.bareDuration) return null

  let index = at + lead
  let minutes = 0
  let read = false
  for (let part = 0; part < 2; part++) {
    const key = words[index]?.key ?? ''
    const glued = /^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+)(?:m|min)?)?$/.exec(key)
    if (glued && key !== '' && (glued[1] !== undefined || /m(?:in)?$/.test(key))) {
      minutes +=
        Math.round(Number((glued[1] ?? '0').replace(',', '.')) * 60) + Number(glued[2] ?? 0)
      read = true
      index++
      continue
    }
    const count = /^\d+(?:[.,]\d+)?$/.test(key)
      ? Number(key.replace(',', '.'))
      : (g.numbers[bare(words[index])] ?? null)
    const unit = g.units[bare(words[index + 1])]
    if (count === null || (unit !== 'minute' && unit !== 'hour')) break
    minutes += Math.round(count * (unit === 'hour' ? 60 : 1))
    read = true
    index += 2
  }
  if (!read || minutes <= 0 || minutes > 1440 || (!lead && index - at < 2)) return null
  return { kind: 'duration', at, end: index, apply: (into) => (into.fields.duration = minutes) }
}

function wordAt(words: readonly Word[], at: number): Found | null {
  const raw = words[at]?.raw ?? ''
  const key = words[at]?.key ?? ''
  const tag = TAG.exec(raw.replace(/[,;.]+$/u, ''))
  if (tag?.[1]) {
    const name = tag[1]
    return {
      kind: 'tag',
      at,
      end: at + 1,
      apply: (into) => {
        if (!into.fields.tags.includes(name)) into.fields.tags.push(name)
      },
    }
  }
  const person = PERSON.exec(raw.replace(/[,;]+$/u, ''))
  if (person?.[1]) {
    const name = person[1]
    return { kind: 'assignee', at, end: at + 1, apply: (into) => (into.fields.assignee = name) }
  }
  const priority = PRIORITY.exec(key) ?? (key === '!!!' ? ['', '1'] : null)
  if (priority?.[1]) {
    const level = Number(priority[1]) as Priority
    return { kind: 'priority', at, end: at + 1, apply: (into) => (into.fields.priority = level) }
  }
  return null
}

function foundAt(words: readonly Word[], at: number, g: Grammar, clock: Clock): Found | null {
  const marked =
    wordAt(words, at) ?? remindAt(words, at, g, clock) ?? deadlineAt(words, at, g, clock)
  if (marked) return marked

  const repeat = repeatAt(words, at, g, clock)
  if (repeat) {
    const text = ruleText(repeat.rule)
    const { rule, first, time } = repeat
    return {
      kind: 'repeat',
      at,
      end: repeat.end,
      slots: ['repeat'],
      apply(into) {
        into.fields.recurrence = text
        if (time && into.fields.time === undefined) into.fields.time = time
        if (into.fields.due === undefined || first) {
          const from = first ?? clock.today
          const due = nextDate(rule, from, addDays(from, -1)) ?? from
          const at = into.fields.time
          const gone = !first && due === clock.today && at !== undefined && !ahead(at, clock)
          into.fields.due = gone ? (nextDate(rule, addDays(due, 1), due) ?? due) : due
        }
      },
    }
  }

  const duration = durationAt(words, at, g)
  if (duration) return duration

  const when = whenAt(words, at, g, clock)
  if (!when) return null
  const { day, time } = when
  return {
    kind: 'when',
    at,
    end: when.end,
    slots: [...(day ? ['day'] : []), ...(time ? ['time'] : [])],
    apply(into) {
      if (day) into.fields.due = day
      if (time) into.fields.time = time
    },
  }
}

const ahead = (time: string, clock: Clock): boolean =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) > clock.minutes

const kept = (keep: readonly { from: number; to: number }[], from: number, to: number): boolean =>
  keep.some((span) => span.from < to && span.to > from)

const slotsOf = (one: Found): readonly string[] => one.slots ?? [one.kind]

const MANY = new Set<string>(['tag', 'remind'])

function standing(found: readonly Found[]): Found[] {
  const last = new Map<string, Found>()
  for (const one of found) for (const slot of slotsOf(one)) last.set(slot, one)
  return found.filter(
    (one) => MANY.has(one.kind) || slotsOf(one).some((slot) => last.get(slot) === one),
  )
}

export function parseQuickAdd(
  text: string,
  langs: readonly string[],
  now: Date,
  options: QuickAddOptions = {},
): QuickAdd {
  const words = wordsOf(text)
  const grammars = grammarsFor(langs)
  const clock = clockOf(now)
  const escaped = options.escaped ?? []
  const keep = [...(options.keep ?? []), ...escaped]

  const found: Found[] = []
  for (let at = 0; at < words.length;) {
    let best: Found | null = null
    for (const g of grammars) {
      const one = foundAt(words, at, g, clock)
      if (one && (!best || one.end > best.end)) best = one
    }
    const from = words[at]?.from ?? 0
    const to = words[(best?.end ?? at + 1) - 1]?.to ?? from
    if (best && !kept(keep, from, to)) {
      found.push(best)
      at = best.end
    } else {
      at++
    }
  }

  const chosen = standing(found)
  const result: QuickAdd = { text: '', fields: { tags: [], remind: [] }, chips: [] }
  for (const one of chosen) if (one.kind !== 'repeat') one.apply(result)
  for (const one of chosen) if (one.kind === 'repeat') one.apply(result)

  const { time } = result.fields
  if (time && result.fields.due === undefined) {
    result.fields.due = ahead(time, clock) ? clock.today : addDays(clock.today, 1)
  }

  result.chips = chosen.map((one) => ({
    kind: one.kind,
    from: words[one.at]?.from ?? 0,
    to: words[one.end - 1]?.to ?? 0,
  }))
  result.text = wordsLeft(text, result.chips)

  const notTags = new Set(escapedTags(text, escaped))
  for (const tag of tagsIn(result.text)) {
    if (!notTags.has(tag) && !result.fields.tags.includes(tag)) result.fields.tags.push(tag)
  }
  return result
}

function escapedTags(text: string, escaped: readonly { from: number }[]): string[] {
  const out: string[] = []
  for (const { from } of escaped) {
    const name = ESCAPED_TAG.exec(text.slice(from))?.[1]
    if (name) out.push(name)
  }
  return out
}

const ESCAPED_TAG = new RegExp(String.raw`^#(${TAG_NAME})`, 'u')

function wordsLeft(text: string, chips: readonly Chip[]): string {
  let left = ''
  let at = 0
  for (const chip of chips) {
    left += `${text.slice(at, chip.from)} `
    at = chip.to
  }
  return `${left}${text.slice(at)}`.replace(/\s+/gu, ' ').trim()
}
