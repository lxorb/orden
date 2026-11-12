import { movedTo } from '../space-paths'
import { isRecord, isString, keepJson, stored } from '../stored'

export const ROOTS_MOVED = 'orden:roots-moved'

export interface RootMoved {
  from: string
  to: string
}

const isMove = (one: unknown): one is RootMoved =>
  isRecord(one) && isString(one.from) && isString(one.to)

export function rootsMoved(): RootMoved[] {
  const said = stored(ROOTS_MOVED)
  return Array.isArray(said) ? said.filter(isMove) : []
}

export function noteRootsMoved(moves: readonly RootMoved[]): void {
  if (!moves.length) return
  const kept = rootsMoved().filter((one) => !moves.some((move) => move.from === one.from))
  keepJson(ROOTS_MOVED, [...kept, ...moves])
}

export function movedRoot(root: string, moves: readonly RootMoved[]): string | null {
  for (const { from, to } of moves) {
    const now = movedTo(root, from, to)
    if (now !== null) return now
  }
  return null
}
