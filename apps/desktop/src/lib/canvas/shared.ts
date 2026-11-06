import type { Canvas, InkStroke } from './format'
import type { Point } from './geometry'

export interface Hand {
  id: number
  name: string
  colour: string
  at: Point
  stroke: InkStroke | null
}

export interface Reachable {
  undo: boolean
  redo: boolean
}

export interface SharedPlane {
  push: (before: Canvas, after: Canvas) => void
  undo: () => boolean
  redo: () => boolean
  hand: (at: Point | null, drawing: InkStroke | null) => void
}

export interface PlaneSurface {
  readonly canvas: Canvas
  shared: SharedPlane | null
  arrived: (canvas: Canvas) => void
  handsAre: (hands: readonly Hand[]) => void
  historyIs: (reachable: Reachable) => void
}
