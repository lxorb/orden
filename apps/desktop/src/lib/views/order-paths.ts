import { type Base, readBase, writeBase } from '@orden/bases'
import { folderNotePath } from '../folder-notes'
import { folderOf, relativeTo } from '../space-paths'
import { type Entry, workspace } from '../workspace.svelte'
import { noteText, writeNoteText } from '../workspace/note-text'

function movedId(id: string, from: string, to: string): string {
  if (id === from) return to
  if (id.startsWith(`${from}#`) || id.startsWith(`${from}/`)) return to + id.slice(from.length)
  return id
}

function movedOrder(base: Base, from: string, to: string): Base | null {
  let changed = false as boolean
  const views = base.views.map((view) => {
    const order = view.orden.order
    if (!order) return view
    const next = Object.fromEntries(
      Object.entries(order).map(([group, ids]) => {
        const moved = ids.map((id) => movedId(id, from, to))
        if (moved.some((id, at) => id !== ids[at])) changed = true
        return [group, moved]
      }),
    )
    return { ...view, orden: { ...view.orden, order: next } }
  })
  return changed ? { ...base, views } : null
}

function basesIn(entry: Entry, found: string[] = []): string[] {
  for (const one of entry.children) {
    if (one.is_dir) basesIn(one, found)
    else if (/\.base$/i.test(one.name)) found.push(one.path)
  }
  return found
}

function movedPath(path: string, from: string, to: string): string {
  if (path === from) return to
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
}

function foldersNotes(root: string, path: string): string[] {
  const found: string[] = []
  for (let dir = folderOf(path); dir.length > root.length; dir = folderOf(dir)) {
    found.push(folderNotePath(dir), `${dir}.md`)
  }
  return found
}

function movedFoldersNotes(tree: Entry, from: string, to: string): string[] {
  const moved = entryAt(tree, to) ?? entryAt(tree, from)
  if (!moved?.is_dir) return [folderNotePath(to), `${to}.md`]
  const found: string[] = []
  const walk = (dir: Entry) => {
    const now = movedPath(dir.path, from, to)
    found.push(folderNotePath(now), `${now}.md`)
    for (const one of dir.children) if (one.is_dir) walk(one)
  }
  walk(moved)
  return found
}

function entryAt(entry: Entry, path: string): Entry | null {
  if (entry.path === path) return entry
  const next = entry.children.find((one) => path === one.path || path.startsWith(`${one.path}/`))
  return next ? entryAt(next, path) : null
}

const FENCE = /^(```+|~~~+)base[^\n]*\n([\s\S]*?)^\1[^\S\n]*$/gm

export function movedWords(text: string, fenced: boolean, was: string, now: string): string | null {
  const rewrite = (words: string): string | null => {
    let base: Base
    try {
      base = readBase(words)
    } catch {
      return null
    }
    const next = movedOrder(base, was, now)
    return next ? writeBase(next, words) : null
  }
  if (!fenced) return rewrite(text)
  let changed = false as boolean
  const after = text.replace(FENCE, (whole, fence: string, body: string) => {
    const next = rewrite(body)
    if (next === null) return whole
    changed = true
    const head = whole.slice(0, whole.indexOf('\n') + 1)
    return `${head}${next.endsWith('\n') ? next : `${next}\n`}${fence}`
  })
  return changed ? after : null
}

export async function orderMoved(
  tree: Entry,
  root: string,
  from: string,
  to: string,
): Promise<void> {
  const was = relativeTo(root, from)
  const now = relativeTo(root, to)
  if (!was || !now || was === now) return
  const files = basesIn(tree).map((path) => ({ path: movedPath(path, from, to), fenced: false }))
  const own = [...movedFoldersNotes(tree, from, to), `${from}.md`]
  const notes = [...new Set([...own, ...foldersNotes(root, to)])].map((path) => ({
    path,
    fenced: true,
  }))
  for (const { path, fenced } of [...files, ...notes]) {
    const before = await noteText(workspace, path)
    if (!before?.includes(was)) continue
    const after = movedWords(before, fenced, was, now)
    if (after !== null && after !== before)
      await writeNoteText(workspace, path, before, after, { undoable: false })
  }
}
