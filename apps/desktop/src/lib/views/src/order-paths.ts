import type { Entry } from '@orden/contracts'
import { type Base, readBase, writeBase } from '@orden/bases'
import { links } from '../../link-index/src/api'
import { relativeTo } from '../../platform/src/api'
import { noteText, workspace, writeNoteText } from '../../workspace/src/api'
import { drawnFences } from './drawn-fences'

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

function baseFiles(entry: Entry, found: string[] = []): string[] {
  for (const one of entry.children) {
    if (one.is_dir) baseFiles(one, found)
    else if (/\.base$/i.test(one.name)) found.push(one.path)
  }
  return found
}

function movedPath(path: string, from: string, to: string): string {
  if (path === from) return to
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
}

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
  let after = text
  for (const fence of drawnFences(text).reverse()) {
    const next = fence.margin ? rewrite(fence.words) : null
    if (next === null) continue
    const body = next.endsWith('\n') ? next : `${next}\n`
    after = after.slice(0, fence.from) + body + after.slice(fence.to)
  }
  return after === text ? null : after
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
  const files = baseFiles(tree).map((path) => ({ path: movedPath(path, from, to), fenced: false }))
  const notes = links
    .basesIn(root)
    .map((path) => ({ path: movedPath(path, from, to), fenced: true }))
  for (const { path, fenced } of [...files, ...notes]) {
    const before = await noteText(workspace, path)
    if (!before?.includes(was)) continue
    const after = movedWords(before, fenced, was, now)
    if (after !== null && after !== before)
      await writeNoteText(workspace, path, before, after, { undoable: false })
  }
}
