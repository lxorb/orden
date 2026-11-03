/** The one door every download in the app goes through on its way out: a file a web
 *  tab's page is saving, an export, a picture of a drawing, a chat's attachment. Each
 *  says here that it has started, and the reader sees it go - the file flies from where
 *  it was asked for to the downloads glyph - and hears it, through the app's one live
 *  region. See flight.ts for the flight and #1048 for why.
 *
 *  Where it was asked for is the thing nobody but the window knows by then. A menu's
 *  row has closed, a save dialog has been and gone, so the last press in the window is
 *  remembered here, from the first paint: the element it landed on, and where. This
 *  file is in front of the first paint for that one reason, and so it is two listeners
 *  and nothing else; the flight itself is fetched with the first download. */

/** The last press in the window: the element it landed on, and where the pointer was.
 *  A key that pressed a button has no pointer, and says so with nulls. */
export interface Press {
  target: Element | null
  x: number | null
  y: number | null
  /** When, on the clock `performance.now` keeps. */
  at: number
}

let last: Press | null = null

/** The last press the window heard, or null before the first. */
export function lastPress(): Press | null {
  return last
}

function heard(event: PointerEvent | MouseEvent) {
  const target = event.target instanceof Element ? event.target : null
  // A click a key made is a click at nought, nought: the element is the place then.
  const keyed = event.type === 'click' && event.detail === 0
  last = {
    target,
    x: keyed ? null : event.clientX,
    y: keyed ? null : event.clientY,
    at: performance.now(),
  }
}

let watching = false

/** Starts remembering presses. Once, from main.ts; on capture, so a press a control
 *  stops on its way is still a press. */
export function watchPresses(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('pointerdown', heard, { capture: true, passive: true })
  window.addEventListener('click', heard, { capture: true, passive: true })
}

/** Where a download came from, as well as whoever started it knows. */
export interface Origin {
  /** The control it was asked for by, when that is known and still on screen. */
  element?: Element | null
  /** The web tab whose page is saving it; its page is the place then, since what was
   *  pressed inside a page is the page's own. */
  tab?: string
}

/** A download has started: it flies and is said. Never throws and never waits: a
 *  download is not held up by its own animation. */
export function downloadStarted(name: string, from: Origin = {}): void {
  if (typeof document === 'undefined') return
  // Read now, before the flight is fetched: the press that asked for this one.
  const press = last
  void import('./flight').then(
    (one) => one.started(name, from, press),
    () => undefined,
  )
}
