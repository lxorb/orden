import type { Entry } from './workspace.svelte'

export type SortMode =
  | 'name'
  | 'name-desc'
  | 'modified-desc'
  | 'modified-asc'
  | 'created-desc'
  | 'created-asc'
  | 'manual'

export const SORT_MODES: readonly SortMode[] = [
  'name',
  'name-desc',
  'modified-desc',
  'modified-asc',
  'created-desc',
  'created-asc',
  'manual',
]

export const FIRST_MODE: SortMode = 'name'

export function isSortMode(value: unknown): value is SortMode {
  return SORT_MODES.some((one) => one === value)
}

const READING = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const EXACTLY = new Intl.Collator(undefined, { numeric: true })

export function byName(one: string, other: string): number {
  const said = READING.compare(one, other)
  if (said !== 0) return said

  const exact = EXACTLY.compare(one, other)
  if (exact !== 0) return exact

  return one < other ? -1 : one > other ? 1 : 0
}

export interface Row {
  readonly name: string
  readonly is_dir: boolean
}

export function byDefault(one: Row, other: Row): number {
  if (one.is_dir !== other.is_dir) return one.is_dir ? -1 : 1

  return byName(one.name, other.name)
}

const TIMES: Partial<Record<SortMode, { of: (entry: Entry) => number; back: boolean }>> = {
  'modified-desc': { of: (entry) => entry.modified, back: true },
  'modified-asc': { of: (entry) => entry.modified, back: false },
  'created-desc': { of: (entry) => entry.created, back: true },
  'created-asc': { of: (entry) => entry.created, back: false },
}

function placesIn(listed: readonly string[]): Map<string, number> {
  const at = new Map<string, number>()
  for (const [index, name] of listed.entries()) if (!at.has(name)) at.set(name, index)
  return at
}

function group(entries: readonly Entry[], mode: SortMode, listed: readonly string[]): Entry[] {
  const out = [...entries]

  if (mode === 'manual') {
    const at = placesIn(listed)
    const place = (entry: Entry) => at.get(entry.name) ?? Infinity
    out.sort((one, other) => place(one) - place(other) || byDefault(one, other))
    return out
  }

  const key = TIMES[mode]
  if (!key) {
    out.sort((one, other) => byName(one.name, other.name))
    return mode === 'name-desc' ? out.reverse() : out
  }

  const way = key.back ? -1 : 1
  out.sort((one, other) => way * (key.of(one) - key.of(other)) || byName(one.name, other.name))
  return out
}

export function ordered(
  children: readonly Entry[],
  mode: SortMode,
  listed: readonly string[],
): Entry[] {
  if (mode === 'manual') return group(children, mode, listed)

  const folders = children.filter((one) => one.is_dir)
  const files = children.filter((one) => !one.is_dir)

  return [...group(folders, mode, listed), ...group(files, mode, listed)]
}

export function shownNames(
  children: readonly Entry[],
  mode: SortMode,
  listed: readonly string[],
): string[] {
  return ordered(children, mode, listed).map((one) => one.name)
}

export function orderedTree(
  tree: Entry,
  mode: SortMode,
  listOf: (folder: string) => readonly string[],
): Entry {
  const here = ordered(tree.children, mode, listOf(tree.path))
  const children = here.map((child) => (child.is_dir ? orderedTree(child, mode, listOf) : child))

  const same =
    children.length === tree.children.length &&
    children.every((child, at) => child === tree.children[at])

  return same ? tree : { ...tree, children }
}

export function renamedIn(listed: readonly string[], from: string, to: string): string[] | null {
  if (!listed.includes(from)) return null

  const out: string[] = []
  for (const name of listed) {
    const now = name === from ? to : name
    if (!out.includes(now)) out.push(now)
  }

  return out
}

export function withoutName(listed: readonly string[], name: string): string[] | null {
  if (!listed.includes(name)) return null

  return listed.filter((one) => one !== name)
}
