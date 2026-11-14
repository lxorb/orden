import { locksHere, locksWork } from '../../platform/src/api'

const BYTES_PER_CHARACTER = 6

const SHARE = 0.2

const FLOOR = 4_000_000
const CEILING = 48_000_000

const TIGHT = 0.8

export const TRIM_AFTER = 5_000

export async function keptBudget(): Promise<number> {
  const estimate =
    'storage' in navigator ? await navigator.storage.estimate().catch(() => null) : null
  const quota = estimate?.quota ?? 0
  if (!quota) return FLOOR
  const budget = Math.min(CEILING, Math.max(FLOOR, (quota * SHARE) / BYTES_PER_CHARACTER))
  const used = estimate?.usage ?? 0
  return used / quota > TIGHT ? Math.round(budget / 2) : Math.round(budget)
}

const WINDOW = 'orden:window'

let holding: Promise<void> | null = null

function holdWindow(locks: LockManager): Promise<void> {
  holding ??= new Promise<void>((held) => {
    void locks
      .request(WINDOW, { mode: 'shared' }, () => {
        held()
        return new Promise<void>(() => undefined)
      })
      .catch(() => held())
  })
  return holding
}

export function holdThisWindow(): void {
  const locks =
    typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined
  if (locks) void holdWindow(locks)
}

export async function aloneHere(): Promise<boolean> {
  const locks = locksHere()
  if (!locks || !(await locksWork(locks))) return false
  await holdWindow(locks)
  const state = await locks.query().catch(() => null)
  if (!state) return false
  return (state.held ?? []).filter((one) => one.name === WINDOW).length <= 1
}

export function forgetWindow(): void {
  holding = null
}
