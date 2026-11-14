import { folderOf, nameOf, samePath, within } from './platform/src/api'
import type { Entry } from './workspace.svelte'

function under(base: string, path: string): boolean {
  if (!path.startsWith(base)) return false

  const next = path[base.length]
  return base.endsWith('/') ? path.length > base.length : next === '/' || next === '\\'
}

function inFolder(tree: Entry, path: string, change: (children: Entry[]) => Entry[]): Entry {
  if (tree.path === path) return { ...tree, children: change([...tree.children]) }
  if (!path.startsWith(tree.path)) return tree

  return {
    ...tree,
    children: tree.children.map((child) => (child.is_dir ? inFolder(child, path, change) : child)),
  }
}

export function withEntry(tree: Entry, entry: Entry): Entry {
  return inFolder(tree, folderOf(entry.path), (children) => [
    ...children.filter((child) => child.path !== entry.path),
    entry,
  ])
}

export function withoutEntry(tree: Entry, path: string): Entry {
  return inFolder(tree, folderOf(path), (children) =>
    children.filter((child) => child.path !== path),
  )
}

export function entryAt(tree: Entry | null, path: string): Entry | null {
  return spelledAs(tree, path) ?? (tree ? spelledOtherwise(tree, path) : null)
}

function spelledAs(tree: Entry | null, path: string): Entry | null {
  if (!tree) return null
  if (tree.path === path) return tree
  if (!path.startsWith(tree.path)) return null

  for (const child of tree.children) {
    const found = spelledAs(child, path)
    if (found) return found
  }
  return null
}

function spelledOtherwise(tree: Entry, path: string): Entry | null {
  const rest = within(tree.path, path)
  if (!rest) return rest === '' ? tree : null

  let at: Entry = tree
  for (const step of rest.split('/')) {
    const next = at.children.find((child) => samePath(child.name, step, tree.path))
    if (!next) return null
    at = next
  }
  return at
}

function rebased(entry: Entry, from: string, to: string): Entry {
  const path = to + entry.path.slice(from.length)
  return {
    ...entry,
    path,
    name: nameOf(path),
    children: entry.children.map((child) => rebased(child, from, to)),
  }
}

export function withComing(tree: Entry, paths: readonly string[]): Entry {
  let out = tree

  for (const path of [...paths].sort()) {
    if (!under(tree.path, path)) continue
    if (entryAt(out, path)) continue

    out = withFolders(out, folderOf(path))
    out = withEntry(out, blank(path, false))
  }

  return out
}

function withFolders(tree: Entry, path: string): Entry {
  if (!path || path === tree.path || entryAt(tree, path)) return tree

  return withEntry(withFolders(tree, folderOf(path)), blank(path, true))
}

function blank(path: string, isFolder: boolean): Entry {
  return {
    name: nameOf(path),
    path,
    is_dir: isFolder,
    modified: 0,
    created: 0,
    children: [],
  }
}

export function withMove(tree: Entry, from: string, to: string): Entry {
  const entry = entryAt(tree, from)
  if (!entry || from === to) return tree
  return withEntry(withoutEntry(tree, from), rebased(entry, from, to))
}

export function withoutRows(tree: Entry, leaving: (entry: Entry) => boolean): Entry {
  const kept = pruned(tree.children, leaving)
  return kept === tree.children ? tree : { ...tree, children: kept }
}

function pruned(children: Entry[], leaving: (entry: Entry) => boolean): Entry[] {
  let touched = false
  const out: Entry[] = []

  for (const child of children) {
    if (leaving(child)) {
      touched = true
      continue
    }

    const inside = child.children.length ? pruned(child.children, leaving) : child.children
    if (inside !== child.children) touched = true
    out.push(inside === child.children ? child : { ...child, children: inside })
  }

  return touched ? out : children
}
