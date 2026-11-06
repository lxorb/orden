import { insideSpace, withinSpace } from '../space-paths'

interface Space {
  id: string
  root: string
}

export type Arrival =
  { kind: 'open'; spaceId: string; path: string } | { kind: 'bring'; spaceId: string; root: string }

export function arrivalOf(
  path: string,
  spaces: readonly Space[],
  activeId: string | null,
  writable: (root: string) => boolean = () => true,
): Arrival | null {
  for (const space of spaces) {
    const inside = withinSpace(space.root, path)
    if (inside) return { kind: 'open', spaceId: space.id, path: insideSpace(space.root, inside) }
  }

  const open = spaces.filter((one) => writable(one.root))
  const into = open.find((one) => one.id === activeId) ?? open[0]
  return into ? { kind: 'bring', spaceId: into.id, root: into.root } : null
}
