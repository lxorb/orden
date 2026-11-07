export const LOAD = 4

export const HOLD = 3

export function quietFor(base: number, cost: number): number {
  return Math.max(base, cost * LOAD)
}

export function waitFor(quiet: number, since: number, now: number): number {
  return Math.max(0, Math.min(quiet, since + quiet * HOLD - now))
}
