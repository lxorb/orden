/** Puts an element at the end of the page while it is up, for a layer opened from
 *  inside another one.
 *
 *  A layer that is placed in the window's own coordinates - `position: fixed`, as a
 *  chat's small layers are (chats/view/Float.svelte) - is placed in its container's
 *  instead wherever an ancestor is moved with `translate` or `transform`, and every
 *  centred sheet is: the emoji picker opened from Settings > Account hung off the
 *  corner of the settings and pushed them sideways. At the end of the body there is
 *  no such ancestor. */
export function portal(node: HTMLElement) {
  document.body.append(node)
  return { destroy: () => node.remove() }
}

/* ── A bubble hung from what it is about ──
 *
 *  A bubble hung from the thing it is about, drawn over the window rather than inside
 *  whatever holds that thing (#1129).
 *
 *  The sentence behind a `?`, the reason a name cannot be taken, a hint's card: each
 *  was placed `position: absolute` against the element it is about, so it was drawn
 *  inside every box that holds that element, and cut by the first one that clips - a
 *  row that cuts its name short, a list that scrolls, a column that slides shut. In
 *  Settings > AI the sentence after *Keep this browser's keys in the vault* was a strip
 *  the height of the name.
 *
 *  So the bubble leaves for the end of the page while it is up, where nothing holds it
 *  and nothing is moved with `translate` (as `portal` above puts a layer), and is
 *  placed `fixed` in the window's own coordinates from where the element it hangs from
 *  is: under it or over it, at its start edge in the reading direction, kept inside the
 *  window, and turned over to the other side where there is no room on its own. Its
 *  rung is its own rule's: `--z-bubble`, over every layer one can be opened in, for
 *  the sentence behind a `?` and a name's reason; a hint's card keeps the step under
 *  the popovers it had (#661). It is hidden while the element it hangs from is hidden
 *  or scrolled out of sight, as it was when it was drawn inside it. It still wears
 *  `.nib-bubble`, so a web page under it is cut for it (web-tab/covers.ts), and is
 *  heard of as it is put in and as it moves.
 *
 *  Followed as the window scrolls anywhere or changes size, as the bubble or anything
 *  holding the element changes size, and on every frame while anything in the window
 *  is moving. */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Hanging {
  /** Which side of the element the bubble hangs on, where there is room. */
  side?: 'below' | 'above'
  /** How far from the element, in CSS pixels. */
  gap?: number
  /** How far in from the element's start edge the bubble's start edge is; less than
   *  nothing is outwards. A custom property's name reads it off the element. */
  inset?: number | `--${string}`
  /** As wide as the element, start to end, rather than as wide as its words - up to
   *  the bubble's own widest. */
  stretch?: boolean
  /** What it hangs from; by default what it is written against, the nearest holder
   *  placed on the page (`position` other than static), as `absolute` placed it. */
  from?: HTMLElement | null
}

/** How close to the window's edge a bubble may come. */
const MARGIN = 8

/** Where a bubble of `size` goes against `at`, in a window of `room`. Pure. */
export function placeOf(
  at: Box,
  size: { width: number; height: number },
  room: { width: number; height: number },
  hanging: { side: 'below' | 'above'; gap: number; inset: number },
  rtl: boolean,
): { left: number; top: number; side: 'below' | 'above' } {
  const { gap, inset } = hanging
  const width = size.width
  const start = rtl ? at.right - inset - width : at.left + inset
  const left = Math.max(MARGIN, Math.min(start, room.width - MARGIN - width))

  const below = at.bottom + gap
  const above = at.top - gap - size.height
  const fitsBelow = below + size.height <= room.height - MARGIN
  const fitsAbove = above >= MARGIN
  const side =
    hanging.side === 'below'
      ? fitsBelow || !fitsAbove
        ? 'below'
        : 'above'
      : fitsAbove || !fitsBelow
        ? 'above'
        : 'below'
  return { left, top: side === 'below' ? below : above, side }
}

/** Whether any of `at` is left once every box that clips it has cut it - an edge of it
 *  is enough, since what a bubble hangs from may be no wider than a word joiner. Pure. */
export function inSight(at: Box, clips: readonly Box[]): boolean {
  let { left, top, right, bottom } = at
  for (const one of clips) {
    left = Math.max(left, one.left)
    top = Math.max(top, one.top)
    right = Math.min(right, one.right)
    bottom = Math.min(bottom, one.bottom)
  }
  return right >= left && bottom >= top
}

/** The boxes that clip what is inside `node`: every holder that does not let what
 *  overflows it show. */
function clipsOf(node: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = []
  for (let up = node.parentElement; up && up !== document.body; up = up.parentElement) {
    const style = getComputedStyle(up)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') found.push(up)
  }
  return found
}

function boxOf(node: Element): Box {
  const box = node.getBoundingClientRect()
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
}

/** Whether the element is drawn at all: a column slid shut hides what is in it. An
 *  engine with no way to ask draws it. */
function drawn(node: Element): boolean {
  if (typeof node.checkVisibility !== 'function') return true
  return node.checkVisibility({ visibilityProperty: true })
}

/** Whether anything in the window is moving towards where it stops: not a spinner, which
 *  never does and would have the bubble asked again on every frame it is up. */
function moving(): boolean {
  if (typeof document.getAnimations !== 'function') return false
  return document
    .getAnimations()
    .some(
      (one) => one.playState === 'running' && one.effect?.getComputedTiming().endTime !== Infinity,
    )
}

/** The nearest holder placed on the page, which `absolute` placed a bubble against. */
function holderOf(node: HTMLElement): HTMLElement | null {
  for (let up = node.parentElement; up && up !== document.body; up = up.parentElement) {
    if (getComputedStyle(up).position !== 'static') return up
  }
  return node.parentElement
}

/** The action: `<span class="nib-bubble" use:hang={{ side: 'below', gap: 6 }}>`, on a
 *  bubble whose rule says `position: fixed` and `--z-bubble`. */
export function hang(node: HTMLElement, hanging: Hanging = {}) {
  let options = hanging
  const from = options.from ?? holderOf(node)
  if (!from) return {}

  const clips = clipsOf(from)

  document.body.append(node)
  node.style.position = 'fixed'
  node.style.inset = 'auto'
  node.style.margin = '0'

  let frame = 0
  const place = () => {
    frame = 0
    if (!from.isConnected) return
    const at = boxOf(from)
    const seen = drawn(from) && inSight(at, clips.map(boxOf))
    node.style.visibility = seen ? '' : 'hidden'
    if (options.stretch) node.style.width = `${at.right - at.left}px`
    const style = getComputedStyle(from)
    const inset =
      typeof options.inset === 'string'
        ? parseFloat(style.getPropertyValue(options.inset)) || 0
        : (options.inset ?? 0)
    const spot = placeOf(
      at,
      { width: node.offsetWidth, height: node.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { side: options.side ?? 'below', gap: options.gap ?? 4, inset },
      style.direction === 'rtl',
    )
    const left = `${spot.left}px`
    const top = `${spot.top}px`
    // Written only when it moved: a page under the bubble is cut again for every write.
    if (node.style.left !== left) node.style.left = left
    if (node.style.top !== top) node.style.top = top
    node.dataset.side = spot.side
    // And again next frame while anything in the window is moving: a column sliding
    // shut or a sheet rising moves the element under the bubble with no event to say so.
    if (moving()) soon()
  }
  const soon = () => {
    frame ||= requestAnimationFrame(place)
  }

  place()
  const moved = ['scroll', 'resize', 'transitionrun', 'animationstart'] as const
  for (const one of moved) window.addEventListener(one, soon, { capture: true, passive: true })
  // Every holder as well as the element: a row put in above it, or a picture arriving,
  // moves the element by changing the size of what holds them both.
  const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null
  sized?.observe(node)
  for (let up: HTMLElement | null = from; up && up !== document.body; up = up.parentElement)
    sized?.observe(up)

  return {
    update(next: Hanging = {}) {
      options = next
      soon()
    },
    destroy() {
      cancelAnimationFrame(frame)
      for (const one of moved) window.removeEventListener(one, soon, { capture: true })
      sized?.disconnect()
      node.remove()
    },
  }
}
