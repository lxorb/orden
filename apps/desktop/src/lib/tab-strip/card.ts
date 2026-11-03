/** Chrome's tab hover card, as numbers and words: where it hangs and what it says. How
 *  long it waits is the reader's own (preview-delay.svelte.ts, #1088). Read off `tab_hover_card_controller.cc` and
 *  `tab_hover_card_bubble_view.cc`; see docs/chrome-tabs.md. Pure, so the whole of it
 *  is tested without a window; hover-card.svelte.ts is what runs it. */

import { withinSpace } from '../space-paths'
import { ownerOf } from '../workspace/sets'

/** Back over a tab this soon after leaving the strip, the card comes at once: the
 *  pointer only slipped off. */
export const REENTRY = 300

/** How far below the tab the card hangs, and how close to the window's edges it may
 *  come. */
const BELOW = 4
const MARGIN = 8

/** A tab's body on the glass. */
export interface Anchor {
  left: number
  right: number
  bottom: number
}

/** Where the card's corner goes: under the tab, from its leading edge - the left, or
 *  the right in a language that reads the other way - and kept inside the window. */
export function spot(
  anchor: Anchor,
  width: number,
  room: number,
  factor: number,
): { x: number; y: number } {
  const start = factor > 0 ? anchor.left : anchor.right - width
  const x = Math.min(Math.max(start, MARGIN), Math.max(MARGIN, room - width - MARGIN))
  return { x, y: anchor.bottom + BELOW }
}

/** The site a page is on, the way Chrome's card names it: the host, without the
 *  `www.` nobody reads. Nothing for an address that is not a site. */
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

/** A space as far as this needs one. */
export interface Place {
  name: string
  root: string
}

/** Where a file lives: its space, and the folders down to it. Nothing for a file in
 *  no space, which has nowhere to say. */
export function whereOf(path: string | null, spaces: readonly Place[]): string {
  if (!path) return ''

  for (const space of spaces) {
    const inside = withinSpace(space.root, path)
    if (inside !== null) return [space.name, ...inside.split('/').slice(0, -1)].join(' / ')
  }

  return ''
}

/** A space as the card names one: what it wears, and what it is called. */
export interface From {
  id: string
  name: string
}

/** The space a web tab is from, beside its site: the space holding its file for a page
 *  kept as a web note, the one it was opened in for one nobody kept. Emil, 2026-10-03.
 *
 *  Only where that is not the space on screen. Arc marks a tab with its space only
 *  where it can turn up outside it - its command bar, Little Arc - and never in the
 *  sidebar, where every tab is the space's own; Orden's strip is the same, since every
 *  space keeps its own tabs (#674). So the card says it where it is news - a page of
 *  another space's opened here, by a link or from the palette - and spends no words
 *  where the answer is the space the reader is already in. */
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
