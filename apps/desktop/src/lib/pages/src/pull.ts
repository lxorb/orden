export const LEAST_REACH = 96
export const MOST_REACH = 160

const GIVE = 3

export const FALL = 250

export const SETTLE = 300

export function reachFor(pageOnScreen: number): number {
  return Math.min(MOST_REACH, Math.max(LEAST_REACH, pageOnScreen / 3))
}

export function risen(raw: number, reach: number, still = false): number {
  if (raw <= 0) return 0

  const most = reach * GIVE
  if (still) return Math.min(most, raw)

  return Math.min(most, raw / (1 + raw / most))
}

export function armed(rise: number, reach: number): boolean {
  return rise >= reach
}

export function fallen(raw: number, elapsed: number, still = false): number {
  if (elapsed >= FALL || raw <= 0) return 0
  if (still || elapsed <= 0) return raw

  const left = 1 - elapsed / FALL
  return raw * left * left
}

export function startedNearEnd(
  viewBottom: number,
  last: { y: number; height: number } | null,
): boolean {
  if (!last) return false

  return viewBottom >= last.y + last.height / 2
}

export interface Pulling {
  raw: number
  at: number
  allowed: boolean
  holding: boolean
  quiet: number
}

export function noPull(): Pulling {
  return { raw: 0, at: 0, allowed: false, holding: false, quiet: 0 }
}

export function began(pull: Pulling, near: boolean, now: number): Pulling {
  return { ...pull, raw: 0, at: now, allowed: near, holding: false, quiet: pull.quiet }
}

export function riseOf(pull: Pulling, reach: number, now: number, still = false): number {
  const raw = pull.holding ? pull.raw : fallen(pull.raw, now - pull.at, still)
  return risen(raw, reach, still)
}

export function wheeled(
  pull: Pulling,
  said: { delta: number; reach: number; now: number; still?: boolean },
): { pull: Pulling; makes: boolean } {
  const { delta, reach, now, still = false } = said

  if (now < pull.quiet) return { pull: { ...pull, raw: 0, at: now }, makes: false }
  if (!pull.allowed || delta <= 0) {
    return { pull: { ...pull, raw: fallen(pull.raw, now - pull.at, still), at: now }, makes: false }
  }

  const raw = fallen(pull.raw, now - pull.at, still) + delta
  if (armed(risen(raw, reach, still), reach)) {
    return { pull: { ...noPull(), at: now, quiet: now + SETTLE }, makes: true }
  }

  return { pull: { ...pull, raw, at: now, holding: false }, makes: false }
}

export function dragged(
  pull: Pulling,
  said: { raw: number; reach: number; now: number; still?: boolean },
): { pull: Pulling; makes: boolean } {
  const { raw, reach, now, still = false } = said
  if (!pull.allowed || now < pull.quiet) return { pull, makes: false }

  const held = { ...pull, raw: Math.max(0, raw), at: now, holding: true }
  if (still && armed(risen(held.raw, reach, still), reach)) {
    return { pull: { ...noPull(), at: now, quiet: now + SETTLE }, makes: true }
  }

  return { pull: held, makes: false }
}

export function lifted(
  pull: Pulling,
  said: { reach: number; now: number; still?: boolean },
): { pull: Pulling; makes: boolean } {
  const { reach, now, still = false } = said
  if (!pull.holding) return { pull: { ...pull, holding: false }, makes: false }

  if (pull.allowed && armed(risen(pull.raw, reach, still), reach)) {
    return { pull: { ...noPull(), at: now, quiet: now + SETTLE }, makes: true }
  }

  return { pull: { ...pull, at: now, holding: false }, makes: false }
}
