import { endOf, HOUR, MINUTE, piecesIn, startOf, wholeOf } from './days'
import type { Goal, Span } from './records'

export const LONG_TIMER = 4 * HOUR

export function reachedOf(goal: Goal, spans: readonly Span[], now: number): number {
  const from = startOf(goal.per, now)
  const mine = (span: Span) => span.activity === goal.activity
  return wholeOf(piecesIn(spans, from, endOf(goal.per, from), now, mine))
}

export function lengthIn(text: string): number | null {
  const said = text.trim().replace(',', '.')
  if (!said) return null
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(said)
  if (clock) return Number(clock[1]) * HOUR + Number(clock[2]) * MINUTE
  const hours = /^\d{1,3}(?:\.\d+)?$/.test(said) ? Number(said) : Number.NaN
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) * MINUTE : null
}

export interface Due {
  key: string
  activity: string | null
  kind: 'goal' | 'timer'
  ms: number
}

export function dueOf(
  goals: readonly Goal[],
  spans: readonly Span[],
  now: number,
  told: ReadonlySet<string>,
): Due[] {
  const out: Due[] = []
  for (const goal of goals) {
    const key = `goal:${goal.id}:${startOf(goal.per, now)}`
    if (told.has(key)) continue
    if (reachedOf(goal, spans, now) >= goal.ms) {
      out.push({ key, activity: goal.activity, kind: 'goal', ms: goal.ms })
    }
  }
  for (const span of spans) {
    if (span.end !== null || span.source !== 'timer') continue
    const key = `timer:${span.id}`
    if (!told.has(key) && now - span.start >= LONG_TIMER) {
      out.push({ key, activity: span.activity, kind: 'timer', ms: now - span.start })
    }
  }
  return out
}
