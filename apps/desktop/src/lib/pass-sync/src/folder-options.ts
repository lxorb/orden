import type { Folder } from '@orden/pass/types'

export interface FolderOption {
  id: string
  name: string
  depth: number
}

export function folderOptions(folders: readonly Folder[]): FolderOption[] {
  const out: FolderOption[] = []
  const known = new Set(folders.map((one) => one.id))
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    const children = folders
      .filter((one) =>
        parent === null ? one.parent === null || !known.has(one.parent) : one.parent === parent,
      )
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    for (const folder of children) {
      if (seen.has(folder.id)) continue
      seen.add(folder.id)
      out.push({ id: folder.id, name: folder.name, depth })
      walk(folder.id, depth + 1, seen)
    }
  }
  walk(null, 0, new Set())
  return out
}
