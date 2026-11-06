export function marked(name: string, value: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-${name}]`)
  return [...all].find((one) => one.getAttribute(`data-${name}`) === value) ?? null
}

function paneBody(paneId: string): HTMLElement | null {
  return marked('pane', paneId)
}

export function shownBox(paneId: string): DOMRect | null {
  const pane = paneBody(paneId)
  if (!pane) return null
  const box = pane.getBoundingClientRect()
  const head = pane.querySelector(':scope > .head')?.getBoundingClientRect()
  const top = head ? head.bottom : box.top
  return new DOMRect(box.left, top, box.width, box.bottom - top)
}

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
  copy.removeAttribute('style')
  copy.style.width = `${box.width}px`
  copy.style.height = `${box.height}px`

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

const SCROLLED = 'data-overview-scrolled'

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
