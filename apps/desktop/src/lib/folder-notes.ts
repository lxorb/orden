import { folderOf, isMarkdownPath, nameOf, withinSpace, withoutExtension } from './space-paths'
import { joinPath } from './tauri'
import { entryAt } from './tree-edits'
import type { Entry } from './workspace.svelte'

const INDEX = /^_?index$/i

export function folderFor(note: string): string {
  return withoutExtension(note)
}

export function folderNotePath(folder: string): string {
  return joinPath(folder, `${nameOf(folder)}.md`)
}

export function isFolderNote(note: string): boolean {
  return isMarkdownPath(note) && nameOf(folderOf(note)) === nameOf(withoutExtension(note))
}

export function folderNote(entry: Entry): Entry | null {
  if (!entry.is_dir) return null

  const notes = entry.children.filter((child) => !child.is_dir && isMarkdownPath(child.name))

  return (
    notes.find((child) => withoutExtension(child.name) === entry.name) ??
    notes.find((child) => INDEX.test(withoutExtension(child.name))) ??
    null
  )
}

export function nestedIn(entry: Entry): Entry[] {
  const own = folderNote(entry)
  return own ? entry.children.filter((child) => child.path !== own.path) : entry.children
}

export function noteToNest(tree: Entry | null, folder: string): string | null {
  const here = entryAt(tree, folderOf(folder))
  if (!here || here.children.some((child) => child.is_dir && child.path === folder)) return null

  const note = here.children.find(
    (child) => !child.is_dir && isMarkdownPath(child.name) && folderFor(child.path) === folder,
  )

  return note?.path ?? null
}

export function unnesting(entry: Entry): { note: string; into: string; folder: string } | null {
  const own = folderNote(entry)
  if (!own || !isFolderNote(own.path) || entry.children.length > 1) return null

  return { note: own.path, into: folderOf(entry.path), folder: entry.path }
}

export function renameSteps(note: string, typed: string): { path: string; name: string }[] {
  const name = withoutExtension(typed.trim())
  if (!name) return []

  const folder = folderOf(note)
  if (!isFolderNote(note)) return [{ path: folder, name }]

  const extension = /\.[^.]+$/.exec(note)?.[0] ?? '.md'

  return [
    { path: note, name: name + extension },
    { path: folder, name },
  ]
}

export function linkedFiles(tree: Entry | null, root: string, rows: readonly string[]): string[] {
  return rows.flatMap((row) => {
    const entry = entryAt(tree, row)
    const file = entry?.is_dir ? (folderNote(entry)?.path ?? folderNotePath(row)) : row
    const inside = withinSpace(root, file)
    return inside === null ? [] : [inside]
  })
}
