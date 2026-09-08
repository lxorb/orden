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

/** Pixels along each edge that belong to the system rather than to the page. */
export interface Edges {
  top: number
  right: number
  bottom: number
  left: number
}

const EDGES = ['top', 'right', 'bottom', 'left'] as const

/** What the activity puts in the page; see MainActivity.kt. `insets` answers the
 *  four edges as JSON, `bars` paints the system bars' own icons. */
interface System {
  insets(): string
  bars(dark: boolean): void
}

/** The activity's side of the bridge, or nothing anywhere else - a browser, a
 *  desktop window, iOS, a test. */
function bridge(): System | undefined {
  const found: unknown = (globalThis as { __NIB_SYSTEM__?: unknown }).__NIB_SYSTEM__
  if (typeof found !== 'object' || found === null) return undefined

  // Checked member by member first, so the cast below only names a shape that
  // has just been shown to be there.
  const shape = found as Partial<System>
  return typeof shape.insets === 'function' && typeof shape.bars === 'function'
    ? (shape as System)
    : undefined
}

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
  const found = bridge()
  if (!found) return

  const read = () => {
    const edges = edgesOf(found.insets())
    if (edges) writeEdges(document.documentElement, edges)
  }

  read()
  Object.assign(window, { __nibInsets: read })
}

/** Android draws the clock, the battery and the gesture bar over the page, and
 *  those are its icons, not ours: dark on a light page, light on a dark one.
 *  No CSS reaches them, so the activity is told which the page is wearing. */
export function tintSystemBars(dark: boolean): void {
  bridge()?.bars(dark)
}
