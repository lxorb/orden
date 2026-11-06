import { folderFor, folderNote } from './folder-notes'
import { folderOf, isMarkdownPath, relativeTo } from './space-paths'
import type { Entry } from './workspace.svelte'

export interface MoveTarget {
  id: string
  label: string
  mark?: 'note'
  space?: { id: string | null; name: string }
}

export interface Space {
  id: string
  name: string
  root: string
}

function under(folder: string, path: string): boolean {
  const one = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  const other = path.replace(/\\/g, '/')
  return other === one || other.startsWith(`${one}/`)
}

export function movesInto(paths: readonly string[], folder: string): boolean {
  return paths.some((path) => folderOf(path) !== folder && !under(path, folder))
}

export function copiesInto(paths: readonly string[], folder: string): boolean {
  return paths.some((path) => !under(path, folder))
}

export function landsIn(paths: readonly string[], folder: string, how: 'move' | 'copy'): boolean {
  return how === 'copy' ? copiesInto(paths, folder) : movesInto(paths, folder)
}

interface Place {
  path: string
  name: string
  note: string | null
}

function placesIn(entry: Entry): Place[] {
  const own = folderNote(entry)
  const out: Place[] = [{ path: entry.path, name: entry.name, note: null }]

  const folders = new Set(entry.children.filter((child) => child.is_dir).map((one) => one.path))

  for (const child of entry.children) {
    if (child.path === own?.path) continue

    if (child.is_dir) out.push(...placesIn(child))
    else if (isMarkdownPath(child.name) && !folders.has(folderFor(child.path))) {
      out.push({ path: folderFor(child.path), name: child.name, note: child.path })
    }
  }

  return out
}

export function moveTargets(input: {
  moving: string | null
  tree: Entry | null
  spaces: readonly Space[]
  here: string | null
}): MoveTarget[] {
  const { moving, tree, spaces, here } = input
  const space = spaces.find((one) => one.root === here) ?? null

  const inside: MoveTarget[] = !tree
    ? []
    : placesIn(tree)
        .filter(
          (place) => moving === null || (place.note !== moving && movesInto([moving], place.path)),
        )
        .map((place) =>
          place.path === tree.path
            ? {
                id: place.path,
                label: space?.name ?? place.name,
                space: { id: space?.id ?? null, name: space?.name ?? place.name },
              }
            : {
                id: place.path,
                mark: 'note' as const,
                label: relativeTo(tree.path, place.path),
              },
        )

  const elsewhere: MoveTarget[] = spaces
    .filter((one) => one.root !== here)
    .map((one) => ({ id: one.root, label: one.name, space: { id: one.id, name: one.name } }))

  return [...inside, ...elsewhere]
}
