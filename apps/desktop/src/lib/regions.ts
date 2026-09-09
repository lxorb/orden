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

/** Every region there is, in the order the window draws them - down the sidebar,
 *  then across the note - which is the order Tab already walks and so the order
 *  F6 walks too.
 *
 *  `space` is the sidebar's header, which is the space's name and its switcher;
 *  `panels` is the row of panel tabs; `search` is the pill under them; `list` is
 *  whichever panel is open; `tabs` is the strip of notes; `editor` is the note;
 *  `status` is the bar under it. */
export const REGIONS = ['space', 'panels', 'search', 'list', 'tabs', 'editor', 'status'] as const

export type Region = (typeof REGIONS)[number]

const RANK = new Map<string, number>(REGIONS.map((name, at) => [name, at]))

export function isRegion(value: string | null | undefined): value is Region {
  return typeof value === 'string' && RANK.has(value)
}

/** The regions on screen, in the order above. What arrives is whatever the page
 *  happens to hold - the sidebar may be shut, and the status bar is left out over
 *  a canvas - in whatever order it was collected, named once each. */
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
