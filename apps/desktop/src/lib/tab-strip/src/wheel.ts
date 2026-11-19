import { wheelPixels } from '../../camera/src/api'

export interface Turn {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
}
export function wheelAlong(turn: Turn, page: number): number {
  if (turn.ctrlKey || Math.abs(turn.deltaX) >= Math.abs(turn.deltaY)) return 0
  return wheelPixels(turn, page).y
}
