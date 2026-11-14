import type { Side } from './gesture'

export interface Room {
  x: number
  y: number
  width: number
  height: number
}

export type Stage = 'tracking' | 'went' | 'stayed'

export const swiping = $state<{
  tab: string | null
  pane: string | null
  room: Room | null
  side: Side
  stage: Stage
  progress: number
  travel: number
  turn: number
}>({
  tab: null,
  pane: null,
  room: null,
  side: 'left',
  stage: 'tracking',
  progress: 0,
  travel: 0,
  turn: 0,
})
