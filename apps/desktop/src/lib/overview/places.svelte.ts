/** Where each space lies on the overview's one canvas, kept across runs (issue #331).
 *
 *  Emil, 2026-11-03: there is one such view, one layout for every space, and where each
 *  space's windows sit, absolutely and against the others, is kept; opening and closing
 *  the view never resets it, and only the camera it starts from differs, on the space
 *  being worked in. So a space is given a place the first time the view shows it - to
 *  the right of every space placed before it - and keeps it. What lies inside a place is
 *  the space's panes and tabs, laid out from them (layout.ts); a place is where that
 *  starts, and how much room it was given.
 *
 *  Kept on this device, under `KEY`, through stored.ts. */

import { forget, keepJson, stored, storedText } from '../stored'
import type { Camera } from './camera'
import type { Box } from './layout'
import { type Keyed, lastingKeys } from './tab-keys'

const KEY = 'nib:overview-places'

/** Where each window was put by hand, which it stays at (free.ts): a window nobody has
 *  moved lies where its space's panes would put it. Written by each tab's lasting name
 *  (tab-keys.ts), since a tab's id is new every run. */
const WINDOWS = 'nib:overview-windows-2'

/** The same as an earlier version wrote it, with private tabs' titles among the names. */
const WINDOWS_BEFORE = 'nib:overview-windows'

/** Where the camera was as the view was last put away, which it opens at again (Emil,
 *  2026-11-04). */
const CAMERA = 'nib:overview-camera'

/** The room between two spaces' places. */
const APART = 360

/** The places as written, with anything that is not one left out. */
export function readPlaces(value: unknown): Record<string, Box> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, Box> = {}
  for (const [key, one] of Object.entries(value as Record<string, unknown>)) {
    if (typeof one !== 'object' || one === null) continue
    const { x, y, w, h } = one as Record<string, unknown>
    const numbers = [x, y, w, h]
    if (numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      out[key] = { x: x as number, y: y as number, w: w as number, h: h as number }
    }
  }
  return out
}

/** The camera as written, or null where it is not one. */
export function readCamera(value: unknown): Camera | null {
  if (typeof value !== 'object' || value === null) return null
  const { x, y, zoom } = value as Record<string, unknown>
  const fine = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  return fine(x) && fine(y) && fine(zoom) && zoom > 0 ? { x, y, zoom } : null
}

/** Where a space not placed yet goes: right of every other, level with the first. */
export function nextPlace(all: Record<string, Box>, size: { w: number; h: number }): Box {
  const placed = Object.values(all)
  if (!placed.length) return { x: 0, y: 0, ...size }
  const right = Math.max(...placed.map((one) => one.x + one.w))
  const top = Math.min(...placed.map((one) => one.y))
  return { x: right + APART, y: top, ...size }
}

/** What an earlier version wrote, without the name of any web page that had no file: a
 *  private tab's title is one of those, and nothing tells which. At launch. */
export function upgradeWindows() {
  if (storedText(WINDOWS_BEFORE) === null) return
  const before = readPlaces(stored(WINDOWS_BEFORE))
  const left = Object.entries(before).filter(([name]) => !name.startsWith('web:~'))
  keepJson(WINDOWS, Object.fromEntries(left))
  forget(WINDOWS_BEFORE)
}

class Places {
  private all = $state.raw<Record<string, Box>>(readPlaces(stored(KEY)))
  /** The windows put by hand this run, by tab id. */
  private put = $state.raw<Record<string, Box>>({})
  private kept: Camera | null = readCamera(stored(CAMERA))

  /** Where the camera was as the view was last put away, or null the first time. */
  get camera(): Camera | null {
    return this.kept
  }

  /** Keeps where the camera is, for the next time the view comes up. */
  remember(camera: Camera) {
    this.kept = { ...camera }
    keepJson(CAMERA, this.kept)
  }

  /** Where each window put by hand lies, by tab. */
  get windows(): Readonly<Record<string, Box>> {
    return this.put
  }

  /** Where the windows of `tabs` were put by hand in an earlier run, found again by
   *  their lasting names; what was put this run stays as it is. Never from inside a
   *  derived: it writes. */
  recall(tabs: readonly Keyed[]) {
    const written = readPlaces(stored(WINDOWS))
    const names = lastingKeys(tabs)
    const next = { ...this.put }
    for (const tab of tabs) {
      const box = written[names.get(tab.id) ?? '']
      if (box && !next[tab.id]) next[tab.id] = box
    }
    this.put = next
  }

  /** Keeps where the windows `lying` are, by tab id, and forgets every window put by
   *  hand whose tab is not one of `tabs` any more: a tab closed takes its place with
   *  it. */
  keepWindows(lying: Readonly<Record<string, Box>>, tabs: readonly Keyed[]) {
    const open = new Set(tabs.map((one) => one.id))
    const next: Record<string, Box> = {}
    for (const [id, box] of Object.entries({ ...this.put, ...lying }))
      if (open.has(id)) next[id] = { x: box.x, y: box.y, w: box.w, h: box.h }
    this.put = next
    const names = lastingKeys(tabs)
    const written: Record<string, Box> = {}
    for (const [id, box] of Object.entries(next)) {
      const name = names.get(id)
      if (name) written[name] = box
    }
    keepJson(WINDOWS, written)
  }

  /** The window of tab `id` back where its panes would put it. */
  forgetWindow(id: string, tabs: readonly Keyed[]) {
    this.put = Object.fromEntries(Object.entries(this.put).filter(([one]) => one !== id))
    this.keepWindows({}, tabs)
  }

  /** Every space and window back where its panes would put it, the spaces in a row
   *  again: the overview's Tidy up. */
  tidy() {
    this.put = {}
    this.all = {}
    keepJson(WINDOWS, {})
    keepJson(KEY, {})
  }

  /** The place of `space`, or null before it has one. */
  at(space: string): Box | null {
    return this.all[space] ?? null
  }

  /** Gives `space` a place `size` big, unless it has one. Never from inside a derived:
   *  it writes. */
  place(space: string, size: { w: number; h: number }): Box {
    const known = this.all[space]
    if (known) return known
    const made = nextPlace(this.all, size)
    this.all = { ...this.all, [space]: made }
    keepJson(KEY, this.all)
    return made
  }
}

export const places = new Places()
