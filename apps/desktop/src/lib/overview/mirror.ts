/** What a pane shows, copied: the window the tab in front of a pane becomes in the
 *  overview (issue #331).
 *
 *  That window starts as the pane itself and shrinks from it, so it has to be exactly
 *  what the pane was showing - the editor's own lines, its caret row, its scroll - or the
 *  first frame is a jump from one picture of the note to another. A copy of the pane's
 *  own elements is that, with nothing to render and nothing to wait for: the editor draws
 *  only the lines in view, so the copy is a screenful.
 *
 *  A copy and not the pane: the pane stays where it is, under the overview, and the
 *  window is free to fly. What a copy would get wrong is put right here - a canvas is
 *  copied blank, so its pixels are drawn across; a frame would load its page again, so
 *  it goes; an id would be in the document twice, and a focusable element would be a
 *  second stop for Tab, so neither is kept. */

/** The element whose `data-` attribute `name` says `value`. */
export function marked(name: string, value: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-${name}]`)
  return [...all].find((one) => one.getAttribute(`data-${name}`) === value) ?? null
}

/** Where a pane's own surface is, under its strip. */
function paneBody(paneId: string): HTMLElement | null {
  return marked('pane', paneId)
}

/** The pane's box, less its strip: where its tab in front is drawn. */
export function shownBox(paneId: string): DOMRect | null {
  const pane = paneBody(paneId)
  if (!pane) return null
  const box = pane.getBoundingClientRect()
  const head = pane.querySelector(':scope > .head')?.getBoundingClientRect()
  const top = head ? head.bottom : box.top
  return new DOMRect(box.left, top, box.width, box.bottom - top)
}

/** A still copy of what `paneId` shows, the size it is shown at, or null where the pane
 *  is not on screen. */
export function mirrorOf(paneId: string): HTMLElement | null {
  const pane = paneBody(paneId)
  const box = shownBox(paneId)
  if (!pane || !box) return null

  const copy = pane.cloneNode(true) as HTMLElement
  copy.querySelector(':scope > .head')?.remove()
  copy.removeAttribute('data-pane')
  copy.setAttribute('inert', '')
  copy.style.width = `${box.width}px`
  copy.style.height = `${box.height}px`

  // And the caret, which would stand still in a copy where the pane's blinks.
  for (const one of copy.querySelectorAll('iframe, video, audio, object, embed, .cm-cursorLayer'))
    one.remove()
  for (const one of copy.querySelectorAll('[id]')) one.removeAttribute('id')
  for (const one of copy.querySelectorAll('[tabindex], [contenteditable]')) {
    one.removeAttribute('tabindex')
    one.removeAttribute('contenteditable')
  }
  copied(pane, copy)
  scrolled(pane, copy)
  return copy
}

/** Each canvas's pixels, drawn onto its copy. */
function copied(from: HTMLElement, to: HTMLElement) {
  const before = from.querySelectorAll('canvas')
  const after = to.querySelectorAll('canvas')
  before.forEach((canvas, index) => {
    const twin = after[index]
    const paint = twin?.getContext('2d')
    if (!twin || !paint || !canvas.width || !canvas.height) return
    twin.width = canvas.width
    twin.height = canvas.height
    try {
      paint.drawImage(canvas, 0, 0)
    } catch {
      // A canvas holding another origin's picture cannot be read; it stays blank.
    }
  })
}

/** Every scroller's place, which a copy starts at the top of. Put back once the copy is
 *  in the document, the only place an element can be scrolled. */
function scrolled(from: HTMLElement, to: HTMLElement) {
  const places: [number, number, number][] = []
  const all = [...from.querySelectorAll('*')]
  all.forEach((one, index) => {
    if (one.scrollTop || one.scrollLeft) places.push([index, one.scrollTop, one.scrollLeft])
  })
  if (!places.length) return

  const twins = [...to.querySelectorAll('*')]
  requestAnimationFrame(() => {
    for (const [index, top, left] of places) {
      const twin = twins[index]
      if (!twin) continue
      twin.scrollTop = top
      twin.scrollLeft = left
    }
  })
}
