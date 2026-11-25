import { middleOf } from './sun-shape'

export interface Aim {
  hub: boolean
  open: number | null
  index: number | null
}
export const RESTING: Aim = { hub: false, open: null, index: null }
export const MIDDLE: Aim = { hub: true, open: null, index: null }
export const MIDDLE_KEY = ' '
const ARROWS: Readonly<Record<string, number>> = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: 270 }
const turnOf = (from: number, to: number): number => ((to - from + 540) % 360) - 180
export function walked(aim: Aim, key: string, counts: readonly (number | null)[]): Aim | null {
  const angle = ARROWS[key]
  const slots = counts.length
  if (angle === undefined || slots === 0) return null
  if (aim.open === null) {
    if (!aim.hub) return null
    const slot = Math.round(angle / (360 / slots)) % slots
    if (counts[slot] == null) return null
    return { hub: false, open: slot, index: null }
  }
  const count = counts[aim.open] ?? 0
  const last = count - 1
  const turn = turnOf(middleOf(aim.open, slots), angle)
  if (Math.abs(turn) > 135) return MIDDLE
  if (Math.abs(turn) < 45) return { ...aim, index: aim.index ?? Math.floor(last / 2) }
  if (turn > 0) return { ...aim, index: aim.index === null ? 0 : Math.min(last, aim.index + 1) }
  return { ...aim, index: aim.index === null ? last : Math.max(0, aim.index - 1) }
}
