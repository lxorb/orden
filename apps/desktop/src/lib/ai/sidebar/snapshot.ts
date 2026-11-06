import type { Turn } from '../chat/types'

export function snapshot(
  turns: readonly Turn[],
  before: readonly Turn[],
  changed: ReadonlySet<string> | 'all',
): Turn[] {
  const held = new Map(before.map((one) => [one.id, one]))
  return turns.map((turn) => {
    const kept = held.get(turn.id)
    if (kept && changed !== 'all' && !changed.has(turn.id)) return kept
    return { ...turn, parts: turn.parts.slice() }
  })
}
