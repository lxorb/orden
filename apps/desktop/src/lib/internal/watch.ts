/** A space Orden keeps itself, heard as the engine hears a folder (sync2/watching.ts):
 *  its folder's own word on every change in place of the crate's watcher, and its index
 *  in place of the crate's listing, both at the paths the app holds (#1068, step 4c).
 *  Nothing writes the folder but Orden, so nothing heard here was guessed. */

import type { Listed, SpaceChange } from '../space-watch'
import { joinPath } from '../tauri'
import { keptShaped, mountOf } from './roots'

/** The kept spaces mounted, where `root` is one the launch has not mounted yet: what the
 *  engine waits for before it reads one, rather than read a file where a space is. */
export async function mountedFor(root: string): Promise<boolean> {
  if (mountOf(root)) return true
  if (!keptShaped(root)) return false
  const { keptSpaces } = await import('./spaces')
  await keptSpaces().catch(() => [])
  return mountOf(root) !== null
}

/** Every change to the kept space at `root`, as the crate's watcher says one. Answers
 *  how to stop, or null where `root` is no kept space. */
export function hearInternal(
  root: string,
  heard: (changes: SpaceChange[]) => void,
): (() => void) | null {
  const found = mountOf(root)
  if (!found || found.inside) return null
  const at = (path: string) => joinPath(root, path)
  return found.mount.folder.heard((changes) => {
    heard(
      changes.map((change): SpaceChange => {
        if (change.kind === 'removed') return { ...change, path: at(change.path) }
        if (change.kind === 'renamed')
          return { ...change, from: at(change.from), path: at(change.path) }
        return { ...change, path: at(change.path) }
      }),
    )
  })
}

/** Everything in the kept space at `root`, as the crate's scan lists a folder. Null
 *  where `root` is no kept space. */
export async function listInternal(root: string): Promise<Listed[] | null> {
  if (!(await mountedFor(root))) return null
  const found = mountOf(root)
  if (!found || found.inside) return null
  return (await found.mount.folder.list()).map(({ path, entry }) => ({
    path: joinPath(root, path),
    dir: !entry.key,
    size: entry.size,
    mtime: entry.modified,
    id: entry.key,
  }))
}
