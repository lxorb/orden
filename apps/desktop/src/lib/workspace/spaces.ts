import { spacesAhead } from './ahead'
import { account } from '../account.svelte'
import { identifier } from '../identifier'
import { invoke, isDesktop, isNative } from '../tauri'
import type { Entry, Naming, Space } from '../workspace.svelte'
import type { Tab } from './documents.svelte'

export interface HoldsSpaces {
  spaces: Space[]
  activeSpaceId: string | null
  tree: Entry | null
  naming: Naming | null
  readonly notes: Entry[]
  readonly tabs: Tab[]
  setsRead: unknown
  fileMoved(from: string, to: string, kind: 'space'): Promise<void>
  fileGone(path: string, kind: 'space'): Promise<void>
  holdingUnder(path: string, run: () => Promise<void>): Promise<void>
  close(id: string): void
  clearSelection(): void
  loadTree(): Promise<void>
  persist(): void
}

async function withKept(
  ahead: { name: string; path: string }[],
): Promise<{ name: string; path: string }[]> {
  if (!isDesktop) return ahead
  return await import('../internal/spaces').then(
    ({ listedWith }) => listedWith(ahead),
    () => ahead,
  )
}

export async function loadSpaces(ws: HoldsSpaces) {
  let found: { name: string; path: string }[] | null = null
  for (let round = 0; round < 3; round += 1) {
    const before = ws.spaces
    const ahead = await spacesAhead()
    found = ahead
      ? await withKept(ahead)
      : await invoke<{ name: string; path: string }[]>('list_spaces').catch(() => null)
    if (!found) return
    if (ws.spaces === before) break
  }
  if (!found) return
  const who = account.user?.id ?? null
  if (!isNative && who !== null) {
    const { leftByAnother } = await import('../left-spaces')
    found = found.filter((one) => !leftByAnother(one.path, who))
  }

  const byRoot = new Map(ws.spaces.map((space) => [space.root, space]))

  const rank = new Map(ws.spaces.map((space, index) => [space.root, index]))
  const at = (root: string) => rank.get(root) ?? Number.MAX_SAFE_INTEGER

  ws.spaces = found
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => at(a.entry.path) - at(b.entry.path) || a.index - b.index)
    .map(
      ({ entry }) =>
        byRoot.get(entry.path) ?? { id: identifier(), name: entry.name, root: entry.path },
    )

  if (!ws.spaces.some((space) => space.id === ws.activeSpaceId)) {
    ws.activeSpaceId = ws.spaces[0]?.id ?? null
  }
}

export function moveSpace(ws: HoldsSpaces, id: string, beforeId: string | null): boolean {
  const moving = ws.spaces.find((space) => space.id === id)
  if (!moving || id === beforeId) return false

  const rest = ws.spaces.filter((space) => space.id !== id)
  const at = beforeId ? rest.findIndex((space) => space.id === beforeId) : rest.length
  if (at < 0) return false

  const next = [...rest.slice(0, at), moving, ...rest.slice(at)]
  if (sameOrder(ws, next)) return false

  ws.spaces = next
  ws.persist()
  return true
}

function sameOrder(ws: HoldsSpaces, next: readonly Space[]): boolean {
  return next.every((space, index) => space.id === ws.spaces[index]?.id)
}

export function applySpaceOrder(ws: HoldsSpaces, names: string[]): boolean {
  const rank = new Map(names.map((name, index) => [name, index]))
  const at = (name: string) => rank.get(name) ?? Number.MAX_SAFE_INTEGER

  const next = ws.spaces
    .map((space, index) => ({ space, index }))
    .sort((a, b) => at(a.space.name) - at(b.space.name) || a.index - b.index)
    .map((entry) => entry.space)

  if (sameOrder(ws, next)) return false

  ws.spaces = next
  ws.persist()
  return true
}

export const TABS_KEY = 'nib:space-tabs'

export const tabSets = { fetched: false }

export async function selectSpace(ws: HoldsSpaces, id: string) {
  if (tabSets.fetched || ws.tabs.length) {
    const { sets } = await import('./sets.svelte')
    return sets.toSpace(id)
  }

  ws.activeSpaceId = id
  ws.clearSelection()
  await ws.loadTree()
  ws.persist()
}
