import type { Along } from './pane-tree'

export type Side = 'left' | 'right' | 'top' | 'bottom'

export type Zone = Side | 'middle'

const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom']

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export const EDGE = 0.28

export function alongOf(side: Side): Along {
  return side === 'left' || side === 'right' ? 'row' : 'column'
}

export function madeFirst(side: Side): boolean {
  return side === 'left' || side === 'top'
}

function depth(box: Box, side: Side, x: number, y: number): number {
  const across = (x - box.left) / box.width
  const down = (y - box.top) / box.height

  switch (side) {
    case 'left':
      return EDGE - across
    case 'right':
      return across - (1 - EDGE)
    case 'top':
      return EDGE - down
    case 'bottom':
      return down - (1 - EDGE)
  }
}

export function zoneAt(box: Box, x: number, y: number, offered: (side: Side) => boolean): Zone {
  let zone: Zone = 'middle'
  let deepest = 0

  for (const side of SIDES) {
    const into = depth(box, side, x, y)
    if (into > deepest && offered(side)) {
      zone = side
      deepest = into
    }
  }

  return zone
}

export function inside(box: Box, x: number, y: number): boolean {
  return x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height
}
