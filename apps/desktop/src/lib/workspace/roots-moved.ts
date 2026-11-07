import { movedTo, samePath } from '../space-paths'
import type { Core } from '../sync2/core'
import type { Change } from '../sync2/store'
import { forget, isRecord, isString, keepJson, stored } from '../stored'

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

export async function followRoots(core: Pick<Core, 'spaces' | 'rootMoved' | 'commit'>) {
  const moves = rootsMoved()
  if (!moves.length) return
  const changes: Change[] = []
  for (const space of core.spaces.values()) {
    const to = movedRoot(space.row.root, moves)
    const taken = [...core.spaces.values()].some((one) => samePath(one.row.root, to ?? ''))
    if (to !== null && !taken) changes.push(...core.rootMoved(space.id, to))
  }
  if (changes.length) await core.commit(changes)
  forget(ROOTS_MOVED)
}
