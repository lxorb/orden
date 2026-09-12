/** The regions of the window, and which one a key steps to.
 *
 *  Tab moves between the things inside a region and stops at the edge of it,
 *  which is what every list, strip and tab row in the app is built for: one tab
 *  stop per widget, the arrows inside it. That leaves one question Tab cannot
 *  answer - how to get out of the note, where Tab indents - and one key answers
 *  it: F6 walks the regions, Shift+F6 walks them back. Firefox and Chrome move
 *  between their own regions with it, and so does every app with more than one
 *  place to be.
 *
 *  Pure: the order is a list, and stepping along it is arithmetic. Which regions
 *  are on screen right now, and how to put the keyboard in one, is focus.ts,
 *  where the DOM is. */

import type { TabKind } from './workspace/documents.svelte'

/** Every region there is, in the order the window draws them - down the sidebar,
 *  then across the note - which is the order Tab already walks and so the order
 *  F6 walks too.
 *
 *  `space` is the sidebar's header, which is the space's name and its switcher;
 *  `panels` is the row of panel tabs; `search` is the pill under them; `list` is
 *  whichever panel is open; `foot` is the row under it, which is the account, the
 *  theme and the settings; `tabs` is the strip of notes; `editor` is the note;
 *  `status` is the bar under it. */
export const REGIONS = [
  'space',
  'panels',
  'search',
  'list',
  'foot',
  'tabs',
  'editor',
  'status',
] as const

export type Region = (typeof REGIONS)[number]

/** The kinds of tab the bar under the note is left out over; see `hasStatusBar` at
 *  the foot of this file. */
const WITHOUT_STATUS = new Set<TabKind>(['graph', 'canvas', 'pages'])

const RANK = new Map<string, number>(REGIONS.map((name, at) => [name, at]))

export function isRegion(value: string | null | undefined): value is Region {
  return typeof value === 'string' && RANK.has(value)
}

/** The regions on screen, in the order above. What arrives is whatever the page
 *  happens to hold - the sidebar may be shut, and the status bar is left out over a
 *  canvas, a page note and the graph - in whatever order it was collected, named
 *  once each. */
function ordered(present: readonly string[]): Region[] {
  const kept = [...new Set(present.filter(isRegion))]
  return kept.sort((a, b) => (RANK.get(a) ?? 0) - (RANK.get(b) ?? 0))
}

/** The region a step lands in. Null only where there are none at all.
 *
 *  The ends meet, because a ring is what one key can walk: pressing F6 enough
 *  times has to come back to the note rather than stopping on the status bar with
 *  nowhere to go. From nowhere - the focus on the page itself, which is where a
 *  fresh window starts - the first press lands at the end the key came from, the
 *  way a menu opened with no cursor in it does. */
export function stepRegion(
  present: readonly string[],
  from: string | null,
  direction: number,
): Region | null {
  const list = ordered(present)
  if (!list.length) return null

  const at = from === null ? -1 : list.findIndex((one) => one === from)
  if (at < 0) return (direction < 0 ? list.at(-1) : list[0]) ?? null

  return list[(at + direction + list.length) % list.length] ?? null
}

/** Whether the bar under the note is drawn over what is open now.
 *
 *  It says what is true of a note: how many words it has, which Vim mode the
 *  keyboard is in, whether the note was too long to parse. Three kinds of tab have
 *  no note for it to say that of - the graph is drawn from the space and holds no
 *  document at all, while a canvas and a page note hold the JSON of a file format,
 *  and counting the words of a file format is a number about nothing. So the bar is
 *  left out over all three rather than drawn empty, and F6 never lands on a region
 *  with nothing in it.
 *
 *  Here rather than in the markup because three other places describe it - the table
 *  in docs/keyboard.md, `ordered` above and `regionsOn` in focus.ts - and a window
 *  that draws one thing while they say another is how the ring and the window drift
 *  apart. Nothing open at all still draws it: that is a window waiting for a note,
 *  not one showing something else. */
export function hasStatusBar(kind: TabKind | null | undefined): boolean {
  return kind === null || kind === undefined || !WITHOUT_STATUS.has(kind)
}
