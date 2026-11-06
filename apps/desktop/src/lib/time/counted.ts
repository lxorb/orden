import type { Piece } from './days'
import type { Rule, Span } from './records'
import type { Lane } from './tracker'

export interface Place {
  lane: Lane
  key: string
  name: string
  ms: number
}

export const isOwn = (span: Span): boolean => span.source === 'manual' || span.source === 'timer'

const keyOf = (span: Span): string | null =>
  span.source === 'space' ? span.space : span.source === 'site' ? span.site : null

export function counted(spans: readonly Span[], rules: readonly Rule[]): Span[] {
  const bySpace = new Map(rules.flatMap((rule) => (rule.space ? [[rule.space, rule]] : [])))
  const bySite = new Map(rules.flatMap((rule) => (rule.site ? [[rule.site, rule]] : [])))
  const out: Span[] = []
  for (const span of spans) {
    if (isOwn(span)) {
      out.push(span)
      continue
    }
    const key = keyOf(span)
    const rule = key === null ? undefined : (span.source === 'space' ? bySpace : bySite).get(key)
    if (rule) out.push({ ...span, activity: rule.activity })
  }
  return out
}

export function placesOf(pieces: readonly Piece[], lane: Lane): Place[] {
  const by = new Map<string, Place>()
  for (const piece of pieces) {
    if (piece.span.source !== lane) continue
    const key = keyOf(piece.span)
    if (key === null) continue
    const place = by.get(key) ?? { lane, key, name: piece.span.label ?? key, ms: 0 }
    place.ms += piece.to - piece.from
    by.set(key, place)
  }
  return [...by.values()].filter((one) => one.ms > 0).sort((one, other) => other.ms - one.ms)
}
