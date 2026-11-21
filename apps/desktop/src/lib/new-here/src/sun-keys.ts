import { SLOTS } from './sun-shape'

export interface Aim {
  hub: boolean
  open: number | null
  index: number | null
}
export const RESTING: Aim = { hub: false, open: null, index: null }
export const MIDDLE: Aim = { hub: true, open: null, index: null }
export const MIDDLE_KEY = ' '
const ARROWS: Readonly<Record<string, number>> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }

function arrowSlot(key: string): number | null {
  return ARROWS[key] ?? null
}
export function walked(aim: Aim, key: string, counts: readonly (number | null)[]): Aim | null {
  const slot = arrowSlot(key)
  if (slot === null) return null
  if (aim.open === null) {
    if (!aim.hub || counts[slot] == null) return null
    return { hub: false, open: slot, index: null }
  }
  const count = counts[aim.open] ?? 0
  const last = count - 1
  const turn = (slot - aim.open + SLOTS) % SLOTS
  if (turn === 2) return MIDDLE
  if (turn === 0) return { ...aim, index: aim.index ?? Math.floor(last / 2) }
  if (turn === 1) return { ...aim, index: aim.index === null ? 0 : Math.min(last, aim.index + 1) }
  return { ...aim, index: aim.index === null ? last : Math.max(0, aim.index - 1) }
}
