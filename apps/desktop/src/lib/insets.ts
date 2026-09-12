/** The edges of the window the system keeps for itself: Android's status bar and
 *  its gesture bar, a display cutout, an iPhone's home indicator.
 *
 *  A browser tells the page about them in CSS, through `env(safe-area-inset-*)`,
 *  and the tokens read exactly that. An Android webview does not: `env()` there
 *  answers the display cutout and nothing else, so a page drawn edge to edge -
 *  which is what Android 15 gives every app whether it asks for it or not - puts
 *  its own bar under the clock and its last row under the gesture bar.
 *
 *  The activity has the numbers, so it hands them over and they are written on
 *  top of the tokens' defaults. Everything that has to clear an edge reads
 *  `var(--inset-*)` and never has to know which of the two answered. */

import { answer, method } from './mobile/bridge'

/** Pixels along each edge that belong to the system rather than to the page. */
export interface Edges {
  top: number
  right: number
  bottom: number
  left: number
}

const EDGES = ['top', 'right', 'bottom', 'left'] as const

/** The four edges out of what the bridge answered, or nothing when it was not
 *  four numbers: a value crossing into the page is unknown until it is read. */
export function edgesOf(text: string): Edges | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Not JSON is not insets, and the tokens' own defaults are still standing.
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null

  const read: Record<string, unknown> = { ...parsed }
  const edges: Edges = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const edge of EDGES) {
    const value = read[edge]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
    edges[edge] = value
  }

  return edges
}

/** Writes them over the tokens' defaults, which is where every bar, sheet and
 *  floating button reads its clearance from. */
export function writeEdges(root: HTMLElement, edges: Edges): void {
  for (const edge of EDGES) root.style.setProperty(`--inset-${edge}`, `${edges[edge]}px`)
}

/** Puts the window's own edges on the page and keeps them there. The activity
 *  calls back on every inset it is handed - a rotation, the keyboard, the bars
 *  hiding - and the reading is done here so one place parses them. */
export function startInsets(): void {
  const insets = method('insets')
  if (!insets) return

  const read = () => {
    const edges = edgesOf(insets())
    if (edges) writeEdges(document.documentElement, edges)
  }

  read()
  answer('__nibInsets', read)
}

/** Android draws the clock, the battery and the gesture bar over the page, and
 *  those are its icons, not ours: dark on a light page, light on a dark one.
 *  No CSS reaches them, so the activity is told which the page is wearing. */
export function tintSystemBars(dark: boolean): void {
  method('bars')?.(dark)
}
