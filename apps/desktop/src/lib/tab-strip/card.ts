import { withinSpace } from '../platform/src/api'
import { ownerOf } from '../workspace/sets'

export const REENTRY = 300

const BELOW = 4
const MARGIN = 8

export interface Anchor {
  left: number
  right: number
  bottom: number
}

export function spot(anchor: Anchor, width: number, room: number): { x: number; y: number } {
  const x = Math.min(Math.max(anchor.left, MARGIN), Math.max(MARGIN, room - width - MARGIN))
  return { x, y: anchor.bottom + BELOW }
}

export function siteOf(address: string | null | undefined): string {
  if (!address) return ''
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return url.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export interface Place {
  name: string
  root: string
}

export function whereOf(path: string | null, spaces: readonly Place[]): string {
  if (!path) return ''

  for (const space of spaces) {
    const inside = withinSpace(space.root, path)
    if (inside !== null) return [space.name, ...inside.split('/').slice(0, -1)].join(' / ')
  }

  return ''
}

export interface From {
  id: string
  name: string
}

export function fromOf(
  path: string | null,
  home: string | null,
  spaces: readonly (Place & From)[],
  here: string | null,
): From | null {
  const owner = ownerOf(path, home, spaces)
  const space = owner === here ? undefined : spaces.find((one) => one.id === owner)
  return space ? { id: space.id, name: space.name } : null
}
