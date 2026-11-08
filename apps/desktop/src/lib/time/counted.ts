import { counts, type Piece } from './days'
import type { Activity, Lane, Rule, Span } from './records'

export interface Place {
  lane: Lane
  key: string
  name: string
  ms: number
}

export const isOwn = (span: Span): boolean => span.source === 'manual' || span.source === 'timer'

const ruleKey = (lane: string, place: string) => `${lane}\u0000${place}`

export function counted(spans: readonly Span[], rules: readonly Rule[]): Span[] {
  const by = new Map(rules.map((rule) => [ruleKey(rule.lane, rule.place), rule]))
  const out: Span[] = []
  for (const span of spans) {
    if (isOwn(span)) {
      out.push(span)
      continue
    }
    const rule = span.place === null ? undefined : by.get(ruleKey(span.source, span.place))
    if (rule) out.push({ ...span, activity: rule.activity })
  }
  return out
}

export function placesOf(pieces: readonly Piece[], lane: Lane): Place[] {
  const by = new Map<string, Place>()
  for (const piece of pieces) {
    const key = piece.span.place
    if (piece.span.source !== lane || key === null) continue
    const place = by.get(key) ?? { lane, key, name: piece.span.label ?? key, ms: 0 }
    place.ms += piece.to - piece.from
    by.set(key, place)
  }
  return [...by.values()].filter((one) => counts(one.ms)).sort((one, other) => other.ms - one.ms)
}

export function recentFirst(activities: readonly Activity[], spans: readonly Span[]): Activity[] {
  const left = new Map(activities.filter((one) => !one.archived).map((one) => [one.id, one]))
  const seen: Activity[] = []
  for (let index = spans.length - 1; index >= 0 && left.size; index -= 1) {
    const id = spans[index]?.activity ?? null
    const one = id === null ? undefined : left.get(id)
    if (id !== null && one) {
      seen.push(one)
      left.delete(id)
    }
  }
  return [...seen, ...left.values()]
}
