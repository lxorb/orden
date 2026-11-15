import { ownerOf } from './sets'

export type Carried = 'file' | 'home' | 'tab'

export interface Placed {
  id: string
  root: string
}

export interface Moving {
  path: string | null
  home: string | null
  shared: string | null
}

export function carried(tab: Moving, spaces: readonly Placed[]): Carried {
  if (tab.path !== null) return ownerOf(tab.path, null, spaces) === null ? 'tab' : 'file'
  return tab.shared === null ? 'home' : 'tab'
}

export function spaceOfTab(
  tab: Moving,
  spaces: readonly Placed[],
  active: string | null,
): string | null {
  return ownerOf(tab.path, tab.shared === null ? tab.home : null, spaces) ?? active
}

export function movingOf(tab: {
  path: string | null
  note: { home: string | null; shared: string | null }
}): Moving {
  return { path: tab.path, home: tab.note.home, shared: tab.note.shared }
}

export function spacesFor<Space extends Placed>(
  tabs: readonly Moving[],
  where: { spaces: readonly Space[]; activeSpaceId: string | null },
  writable: (path: string) => boolean,
  carries: (path: string, root: string) => boolean = () => true,
): Space[] {
  const { spaces } = where
  if (!tabs.length || spaces.length < 2) return []
  const files = tabs.filter((tab) => carried(tab, spaces) === 'file')
  if (files.some((tab) => tab.path !== null && !writable(tab.path))) return []

  const from = new Set(tabs.map((tab) => spaceOfTab(tab, spaces, where.activeSpaceId)))
  const already = from.size === 1 ? [...from][0] : undefined
  return spaces.filter(
    (one) =>
      one.id !== already &&
      writable(one.root) &&
      files.every((tab) => tab.path === null || carries(tab.path, one.root)),
  )
}
