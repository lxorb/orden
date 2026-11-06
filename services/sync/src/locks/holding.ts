import { HOLD_GRACE } from '@orden/online/wire'

export interface Hold {
  device: string
  who: string
  name: string
  since: number
  left: number | null
}

export interface Claim {
  device: string
  who: string
  name: string
  take: boolean
}

export const holdKey = (session: string) => `hold:${session}`

export function holdOf(value: unknown): Hold | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Partial<Hold>
  if (typeof one.device !== 'string' || typeof one.since !== 'number') return null
  return {
    device: one.device,
    who: typeof one.who === 'string' ? one.who : '',
    name: typeof one.name === 'string' ? one.name : '',
    since: one.since,
    left: typeof one.left === 'number' ? one.left : null,
  }
}

export function standing(hold: Hold | null, present: boolean, now: number): Hold | null {
  if (!hold) return null
  if (present) return hold.left === null ? hold : { ...hold, left: null }
  const left = hold.left ?? now
  return now - left >= HOLD_GRACE ? null : { ...hold, left }
}

export function claimed(
  hold: Hold | null,
  claim: Claim,
  present: boolean,
  now: number,
): { hold: Hold; granted: boolean } {
  if (hold?.device === claim.device) {
    return { hold: { ...hold, name: claim.name || hold.name, left: null }, granted: true }
  }
  const kept = standing(hold, present, now)
  if (kept && !claim.take) return { hold: kept, granted: false }
  return {
    hold: { device: claim.device, who: claim.who, name: claim.name, since: now, left: null },
    granted: true,
  }
}
