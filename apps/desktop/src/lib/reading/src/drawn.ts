import type { FileDrawing } from '@orden/editor'
import { decodeTarget } from '@orden/markdown/links'
import { nameOf, invoke, joinPath } from '../../platform/src/api'

export interface Drawn extends FileDrawing {
  root: string
}

const FIRST_PAGE = 1

const AHEAD = '400px'

const FALLBACK_WIDTH = 640

const MOST_PIXELS = 4 * 1024 * 1024

const DRAWN = 'embed-drawn'
const SHEET = 'embed-sheet'

export function drawFile(card: HTMLElement, file: Drawn): () => void {
  if (card.classList.contains(DRAWN)) return () => undefined

  let stopped = false
  const seen = new IntersectionObserver(
    (entries) => {
      if (stopped || !entries.some((entry) => entry.isIntersecting)) return

      seen.disconnect()
      card.classList.add(DRAWN)
      void fill(card, file, () => !stopped && card.isConnected)
    },
    { rootMargin: AHEAD },
  )

  seen.observe(card)

  return () => {
    stopped = true
    seen.disconnect()
  }
}

export function inlineFiles(surface: HTMLElement, root: string | null): () => void {
  if (root === null) return () => undefined

  const cards = surface.querySelectorAll<HTMLElement>('.embed-file[data-file]')
  const stops = [...cards].flatMap((card) => {
    const file = askedBy(card, root)
    return file === null ? [] : [drawFile(card, file)]
  })

  return () => {
    for (const stop of stops) stop()
  }
}

function askedBy(card: HTMLElement, root: string): Drawn | null {
  const kind = card.dataset.kind
  if (kind !== 'pdf' && kind !== 'canvas') return null

  const href = card.querySelector('a[href]')?.getAttribute('href')
  if (href === null || href === undefined || href === '') return null

  const hash = href.indexOf('#')
  const path = written(hash === -1 ? href : href.slice(0, hash))
  if (!path) return null

  const page = Number(card.dataset.page)
  return { kind, path, root, page: Number.isInteger(page) && page >= 1 ? page : null }
}

function written(target: string): string {
  return decodeTarget(target)
}

async function fill(card: HTMLElement, file: Drawn, showing: () => boolean): Promise<void> {
  const width = Math.round(card.clientWidth) || FALLBACK_WIDTH

  const drawing = await (file.kind === 'pdf' ? paperPage(file, width) : plane(file)).catch(
    () => null,
  )
  if (drawing === null || !showing()) {
    card.classList.remove(DRAWN)
    return
  }

  into(card).append(drawing)
}

function into(card: HTMLElement): HTMLElement {
  const named = card.querySelector('a[href]')
  if (!(named instanceof HTMLAnchorElement)) {
    const holder = document.createElement('span')
    holder.className = SHEET
    holder.setAttribute('aria-hidden', 'true')
    card.prepend(holder)
    return holder
  }

  const link = document.createElement('a')
  link.className = `${named.className} ${SHEET}`.trim()
  link.setAttribute('href', named.getAttribute('href') ?? '')
  link.tabIndex = -1
  link.setAttribute('aria-hidden', 'true')
  card.prepend(link)

  return link
}

async function paperPage(file: Drawn, width: number): Promise<HTMLCanvasElement | null> {
  const { openDocument, sheetFor } = await import('../../pdf/src/api')
  const held = await openDocument(joinPath(file.root, file.path))

  try {
    const number = file.page ?? FIRST_PAGE
    if (number > held.doc.numPages) return null

    const page = await held.doc.getPage(number)

    try {
      const at = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width })
      const sheet = document.createElement('canvas')

      const fit = sheetFor(at, MOST_PIXELS, window.devicePixelRatio || 1)
      sheet.width = fit.width
      sheet.height = fit.height

      const context = sheet.getContext('2d', { alpha: false })
      if (!context) return null

      await page.render({ canvas: sheet, canvasContext: context, viewport: at, ...fit.drawn })
        .promise

      return sheet
    } finally {
      page.cleanup()
    }
  } finally {
    await held.close()
  }
}

async function plane(file: Drawn): Promise<SVGSVGElement | null> {
  const text = await invoke<string>('read_note', { path: joinPath(file.root, file.path) })

  const [{ drawingOf }, { canvasSvg }, { pdfFaces }] = await Promise.all([
    import('../../canvas/drawing'),
    import('../../canvas/picture'),
    import('../../canvas/faces'),
  ])

  const drawing = drawingOf({ text, name: nameOf(file.path), path: file.path, root: file.root })
  if (!drawing.canvas.nodes.length && !drawing.canvas.ink.length) return null

  const faces = await pdfFaces(drawing.canvas.nodes, {
    note: joinPath(file.root, file.path),
    root: file.root,
  })
  const holder = document.createElement('div')
  holder.innerHTML = canvasSvg(
    drawing.canvas,
    drawing.palette,
    drawing.path,
    drawing.root,
    true,
    false,
    faces,
  )

  const picture = holder.firstElementChild
  if (!(picture instanceof SVGSVGElement)) return null

  picture.removeAttribute('width')
  picture.removeAttribute('height')

  return picture
}
