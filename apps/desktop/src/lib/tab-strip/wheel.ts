const LINE = 40

export interface Turn {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
}

export function wheelAlong(turn: Turn, page: number): number {
  if (turn.ctrlKey || Math.abs(turn.deltaX) >= Math.abs(turn.deltaY)) return 0

  const unit = turn.deltaMode === 1 ? LINE : turn.deltaMode === 2 ? page : 1
  return turn.deltaY * unit
}
