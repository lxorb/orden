import { links, spaceLinks } from '../link-index.svelte'
import { workspace } from '../workspace.svelte'
import type { Place } from './spaces'

const KEPT = 60_000

type Links = typeof links

interface Held {
  index: Links
  built: Promise<void>
  going: ReturnType<typeof setTimeout> | undefined
  stop: () => void
}

const held = new Map<string, Held>()

export async function indexOf(place: Place): Promise<Links> {
  if (place.open) {
    await links.scanned()
    return links
  }

  const root = place.space.root
  let found = held.get(root)
  if (!found) {
    const index = spaceLinks()
    index.archivedIn = (of) => workspace.archive.keysOf(of)
    const stop = workspace.fileOps.follow((op) => index.follow(op))
    found = { index, built: index.build(root), going: undefined, stop }
    held.set(root, found)
  }

  clearTimeout(found.going)
  found.going = setTimeout(() => letGo(root), KEPT)
  await found.built
  return found.index
}

function letGo(root: string) {
  held.get(root)?.stop()
  held.delete(root)
}

export function heldIndex(place: Place): Links | null {
  return place.open ? links : (held.get(place.space.root)?.index ?? null)
}

export function forgetIndexes(): void {
  for (const [root, one] of held) {
    clearTimeout(one.going)
    letGo(root)
  }
}
