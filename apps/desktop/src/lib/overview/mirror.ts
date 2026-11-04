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

/** A copy of a pane's own elements as they are, and what the copy cannot carry by
 *  itself, paired off before anything is taken out of it: each canvas with its twin, and
 *  each scroller with its twin and where it is scrolled to. Paired by walking the two
 *  together while they are still one shape - by index after the strip was taken out of
 *  the copy, the scrollers landed on the wrong elements and the copy opened at another
 *  place than the pane showed. */
function copyOf(pane: HTMLElement, box: DOMRect) {
  const copy = pane.cloneNode(true) as HTMLElement
  const from = [...pane.querySelectorAll('*')]
  const to = [...copy.querySelectorAll('*')]
  const canvases: [HTMLCanvasElement, HTMLCanvasElement][] = []
  const scrolls: [Element, number, number][] = []
  from.forEach((one, index) => {
    const twin = to[index]
    if (!twin) return
    if (one instanceof HTMLCanvasElement && twin instanceof HTMLCanvasElement)
      canvases.push([one, twin])
    if (one.scrollTop || one.scrollLeft) scrolls.push([twin, one.scrollTop, one.scrollLeft])
  })

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
  for (const [canvas, twin] of canvases) drawnOnto(canvas, twin)
  return { copy, scrolls }
}

/** A still copy of what `paneId` shows, the size it is shown at, or null where the pane
 *  is not on screen. */
export function mirrorOf(paneId: string): HTMLElement | null {
  const pane = paneBody(paneId)
  const box = shownBox(paneId)
  if (!pane || !box) return null
  const { copy, scrolls } = copyOf(pane, box)
  owed.set(copy, scrolls)
  return copy
}

/** Where a copy's scrollers are to be scrolled to, until it is in the document. */
const owed = new WeakMap<Element, [Element, number, number][]>()

/** A copy just put in the document, scrolled where the pane was: at once, the only
 *  moment that is not a frame late - a frame at the top of the note and then the place
 *  it was is a jump. */
export function scrolledIn(copy: Element) {
  scrolledTo(owed.get(copy) ?? [])
  owed.delete(copy)
}

/** A copy of the tab `id` in its strip, as it is drawn there - its shape, its mark, its
 *  name, the colours of the strip it is in - which the window it becomes starts and ends
 *  as, so the window that leaves the strip is the tab and not a likeness of it; or null
 *  for a tab not drawn in a strip. The colours are its strip's: a copy elsewhere would
 *  take the overview's, so what it inherits is written on it. */
export function tabCopyOf(id: string, inherited: Map<Element, string>): HTMLElement | null {
  const tab = marked('box', id)
  const box = tab?.getBoundingClientRect()
  if (!tab || !box || box.width <= 0) return null
  const parent = tab.parentElement
  let given = parent ? inherited.get(parent) : ''
  if (parent && given === undefined) {
    const style = getComputedStyle(parent)
    given = ''
    for (const name of style) {
      if (name.startsWith('--')) given += `${name}:${style.getPropertyValue(name)};`
    }
    for (const name of ['color', 'font-family', 'font-size', 'font-weight', 'line-height'])
      given += `${name}:${style.getPropertyValue(name)};`
    inherited.set(parent, given)
  }
  const copy = tab.cloneNode(true) as HTMLElement
  copy.removeAttribute('data-box')
  copy.classList.remove('away')
  copy.setAttribute('inert', '')
  for (const one of copy.querySelectorAll('[id]')) one.removeAttribute('id')
  copy.style.cssText = `${given ?? ''}${copy.style.cssText}`
  copy.style.position = 'absolute'
  copy.style.left = '0'
  copy.style.top = '0'
  copy.style.transform = 'none'
  copy.style.width = `${box.width}px`
  copy.style.height = `${box.height}px`
  return copy
}

/** What `paneId` shows, copied now, and a way to make it markup that can be kept and
 *  drawn again in another run - each canvas a picture, where each scroller was scrolled
 *  written on it (`SCROLLED`) - later, when there is time: the copy is taken while the
 *  pane still shows it, which is the moment it is leaving, and what is slow about it
 *  waits. Null where the pane is not on screen. */
export function snapshotOf(paneId: string): (() => { html: string; w: number; h: number }) | null {
  const pane = paneBody(paneId)
  const box = shownBox(paneId)
  if (!pane || !box || box.width <= 0 || box.height <= 0) return null
  const { copy, scrolls } = copyOf(pane, box)
  for (const [twin, top, left] of scrolls) twin.setAttribute(SCROLLED, `${top} ${left}`)
  return () => {
    for (const canvas of copy.querySelectorAll('canvas')) {
      try {
        const picture = document.createElement('img')
        picture.src = canvas.toDataURL('image/webp', 0.7)
        picture.className = canvas.className
        picture.style.cssText = canvas.style.cssText
        picture.setAttribute('width', String(canvas.width))
        picture.setAttribute('height', String(canvas.height))
        canvas.replaceWith(picture)
      } catch {
        // Another origin's picture cannot be read out; it stays a blank canvas.
      }
    }
    return { html: copy.outerHTML, w: box.width, h: box.height }
  }
}

/** The attribute a snapshot writes where a scroller was scrolled to, top then left. */
const SCROLLED = 'data-overview-scrolled'

/** Every scroller a drawn snapshot holds put back where it was. */
export function scrolledBack(root: Element) {
  const places: [Element, number, number][] = []
  for (const one of root.querySelectorAll(`[${SCROLLED}]`)) {
    const [top, left] = (one.getAttribute(SCROLLED) ?? '').split(' ').map(Number)
    places.push([one, top ?? 0, left ?? 0])
  }
  scrolledTo(places)
}

function scrolledTo(places: readonly [Element, number, number][]) {
  for (const [twin, top, left] of places) {
    twin.scrollTop = top
    twin.scrollLeft = left
  }
}

/** A canvas's pixels, drawn onto its copy. */
function drawnOnto(canvas: HTMLCanvasElement, twin: HTMLCanvasElement) {
  const paint = twin.getContext('2d')
  if (!paint || !canvas.width || !canvas.height) return
  twin.width = canvas.width
  twin.height = canvas.height
  try {
    paint.drawImage(canvas, 0, 0)
  } catch {
    // A canvas holding another origin's picture cannot be read; it stays blank.
  }
}
