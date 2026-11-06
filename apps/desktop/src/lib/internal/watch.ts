import type { Listed, SpaceChange } from '../space-watch'
import { joinPath } from '../tauri'
import { keptShaped, mountOf } from './roots'

export async function mountedFor(root: string): Promise<boolean> {
  if (mountOf(root)) return true
  if (!keptShaped(root)) return false
  const { keptSpaces } = await import('./spaces')
  await keptSpaces().catch(() => [])
  return mountOf(root) !== null
}

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
