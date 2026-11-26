export const LEAST_REACH = 96
export const MOST_REACH = 160
export const FALL = 260
export const LET_GO = 360
export const SETTLE = 300
export function reachFor(pageOnScreen: number): number {
  return Math.min(MOST_REACH, Math.max(LEAST_REACH, pageOnScreen / 3))
}
export function startedNearEnd(viewBottom: number, last: { y: number; height: number } | null): boolean {
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
export const noPull = (): Pulling => ({ raw: 0, at: 0, allowed: false, holding: false, quiet: 0 })
export const began = (pull: Pulling, near: boolean, now: number): Pulling => ({
  ...pull,
  raw: 0,
  at: now,
  allowed: near && now >= pull.quiet,
  holding: false,
})
export const full = (pull: Pulling, reach: number): boolean => pull.raw >= reach
export function riseOf(pull: Pulling, reach: number, now: number, still = false): number {
  const raw = Math.min(reach, Math.max(0, pull.raw))
  if (pull.holding) return raw
  const gone = (now - pull.at) / FALL
  if (still || gone >= 1 || raw <= 0) return 0
  return raw * (1 - Math.max(0, gone)) ** 3
}
export function dragged(pull: Pulling, said: { raw: number; now: number }): Pulling {
  if (!pull.allowed) return pull
  return { ...pull, raw: Math.max(0, said.raw), at: said.now, holding: true }
}
export function wheeled(pull: Pulling, said: { delta: number; now: number }): Pulling {
  if (!pull.allowed) return { ...pull, at: said.now }
  return { ...pull, raw: Math.max(0, pull.raw + said.delta), at: said.now, holding: true }
}
export function lifted(pull: Pulling, said: { reach: number; now: number }): { pull: Pulling; makes: boolean } {
  if (!pull.holding) return { pull, makes: false }
  if (pull.allowed && full(pull, said.reach)) {
    return { pull: { ...noPull(), at: said.now, quiet: said.now + SETTLE }, makes: true }
  }
  return { pull: { ...pull, at: said.now, holding: false }, makes: false }
}
