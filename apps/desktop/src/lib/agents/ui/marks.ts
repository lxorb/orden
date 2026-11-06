import type { Worn } from '../../agent-marks.svelte'
import type { Seen } from './seen'

export const ACTIVE_FOR = 15_000

export type ColourOf = (agent: string) => string

export function wornAt(seen: Seen, now: number, colourOf: ColourOf): Record<string, Worn> {
  const worn: Record<string, Worn> = {}

  for (const [tab, touch] of Object.entries(seen.acting)) {
    if (tab in seen.tabs) continue

    const state = stateOf(seen, touch.agent, touch.at, now)
    if (state !== 'none') {
      worn[tab] = {
        agent: touch.agent,
        colour: colourOf(touch.agent),
        stopped: state === 'stopped',
      }
    }
  }

  return worn
}

function stateOf(
  seen: Seen,
  agent: string,
  at: number,
  now: number,
): 'acting' | 'stopped' | 'none' {
  const stoppedAt = seen.halted[agent] ?? seen.stopped
  if (stoppedAt !== null) {
    return at + ACTIVE_FOR > stoppedAt ? 'stopped' : 'none'
  }

  return now - at < ACTIVE_FOR ? 'acting' : 'none'
}

export function nextLapse(seen: Seen, now: number): number | null {
  let soonest: number | null = null

  for (const touch of Object.values(seen.acting)) {
    const ends = touch.at + ACTIVE_FOR
    if (ends > now && (soonest === null || ends < soonest)) soonest = ends
  }

  return soonest
}

export function sameMarks(one: Record<string, Worn>, other: Record<string, Worn>): boolean {
  const keys = Object.keys(one)
  if (keys.length !== Object.keys(other).length) return false

  return keys.every((key) => {
    const a = one[key]
    const b = other[key]
    if (!a || !b) return false
    return a.agent === b.agent && a.colour === b.colour && a.stopped === b.stopped
  })
}
