import { movedTo, samePath } from '../../space-paths'
import type { Core } from './core'
import type { Change } from './store'
import { workspace } from './ports'

export async function followRoots(core: Pick<Core, 'spaces' | 'rootMoved' | 'commit'>) {
  const moves = workspace().rootMoves()
  if (!moves.length) return
  const changes: Change[] = []
  for (const space of core.spaces.values()) {
    let to: string | null = null
    for (const { from, to: now } of moves) {
      to = movedTo(space.row.root, from, now)
      if (to !== null) break
    }
    const taken = [...core.spaces.values()].some((one) => samePath(one.row.root, to ?? ''))
    if (to !== null && !taken) changes.push(...core.rootMoved(space.id, to))
  }
  if (changes.length) await core.commit(changes)
  workspace().forgetRootMoves()
}
