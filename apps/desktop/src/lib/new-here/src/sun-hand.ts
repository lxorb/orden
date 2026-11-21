import type { Point } from './sun-shape'

export type Picked = 'click' | 'pull' | 'others'
export interface Shape {
  outline: Point[]
  each: number
}
export interface SunHand {
  settled: (slot: number, index: number) => Promise<void>
  shapeOf: (slot: number, index: number) => Shape | null
}
export function sunHand(): SunHand {
  return { settled: () => Promise.resolve(), shapeOf: () => null }
}
