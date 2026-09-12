/** A page note, out: as a PDF, as a PNG per page, as an SVG per page.
 *
 *  One description of what a page looks like, three files made out of it, which is
 *  the arrangement a canvas's picture code already has and for the same reason: an
 *  SVG is what a page is, a PNG is that SVG rasterised by the browser, and the PDF
 *  is the ink put onto real PDF pages.
 *
 *  **The PDF is not a picture of the pages.** A note made from a paper keeps that
 *  paper, so the export opens the original PDF and draws the ink onto its pages as
 *  vector paths: the text of the paper is still text, still selectable, still
 *  searchable, and the annotations somebody wrote by hand are on top of it at full
 *  resolution rather than as a photograph of a screen. A note with no paper behind
 *  it gets pages made at its own sizes instead, which is the same code with an empty
 *  document under it.
 *
 *  The ink goes into the page's own content and not into an `/Ink` annotation. Both
 *  would be the same strokes twice, and of the two, content is the one every reader
 *  and every printer draws: pdf-lib has no annotation writer of its own, and ink
 *  only a reader that renders annotations can see is ink that prints as a blank
 *  page. What that costs is that the strokes cannot be rubbed out again in another
 *  app - which is what the `.pages` file beside the paper is for, and why the
 *  paper is never written over.
 *
 *  pdf-lib is loaded when an export runs and not before, like the rest of the
 *  export's libraries. */

import { onPage, pagesOf } from '@nib/markdown/pages'
import { type Canvas, type InkStroke, type PageNode, readCanvas } from '../canvas/format'
import { INK_STYLES, inkOpacity, outlineOf } from '../canvas/ink'
import { inkColour, type Palette } from '../canvas/paint'
import { readPalette } from '../canvas/palette'
import { inkSvg } from '../canvas/svg'
import { fileBytes } from '../bytes'
import { chooseTarget, download, writeFile } from '../export/save'
import { zipOf } from '../export/zip'
import { isDesktop, joinPath } from '../tauri'

/** What an export of a page note is about. */
export interface PagesOut {
  canvas: Canvas
  palette: Palette
  /** The note's own path, so the PDF its pages name can be found beside it. */
  path: string | null
  root: string | null
  name: string
}

/** The note that is open, as the three exports below want it.
 *
 *  Built from the words the tab holds rather than from the store on screen, which is
 *  the same thing: every edit is written back into those words as it is made, so a
 *  page note is never further from its text than a keystroke is. `drawingOf` in
 *  export/drawing.ts is this same one function for a canvas. */
export function pagesOutOf(open: {
  text: string
  name: string
  path: string | null
  root: string | null
}): PagesOut {
  return {
    canvas: readCanvas(open.text),
    // The theme's own colours as colours: a file that has left the app carries no
    // stylesheet, so nothing in it can look `var(--canvas-1)` up any more.
    palette: readPalette(document.documentElement),
    path: open.path,
    root: open.root,
    name: open.name,
  }
}

/** What the files are called: the note's name without its extension. */
function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'Pages'
}

/** How many digits a page number is padded to, so a folder of pages sorts in page
 *  order in every file list rather than putting page 10 before page 2. */
function numbered(at: number, of: number): string {
  return String(at).padStart(String(of).length, '0')
}

/** The strokes on one page, in the order they were drawn. */
function inkOn(canvas: Canvas, page: PageNode): InkStroke[] {
  const box = { x: page.x, y: page.y, width: page.width, height: page.height }
  return canvas.ink.filter((stroke) => onPage(stroke, box))
}

/** One page as an SVG, in the page's own coordinates: the origin at its top left,
 *  and the ink moved so a stroke drawn half way down the third page is half way down
 *  its own picture.
 *
 *  White paper, because paper is white. A page note honours the theme on screen -
 *  that is what a screen is for - and a sheet that has left the app is a sheet: ink
 *  that was drawn light on a dark page would be invisible on it, so the export
 *  writes the page the way it would be printed. */
function pageSvg(out: PagesOut, page: PageNode, index: number): string {
  const strokes = inkOn(out.canvas, page).map((stroke) => moved(stroke, -page.x, -page.y))
  const ink = inkSvg(strokes, out.palette)
  const label = `Page ${index}`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}"`,
    ` viewBox="0 0 ${page.width} ${page.height}">`,
    `<title>${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`,
    `<rect width="${page.width}" height="${page.height}" fill="#ffffff"/>`,
    ink,
    '</svg>',
  ].join('')
}

/** A stroke shifted, which is what putting a page's ink in the page's own
 *  coordinates is. */
function moved(stroke: InkStroke, byX: number, byY: number): InkStroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({ ...point, x: point.x + byX, y: point.y + byY })),
  }
}

/** One SVG rasterised by the browser, which is how the canvas's PNG is made too.
 *  Null where the browser refused the picture, which is a page nothing could be
 *  drawn from rather than an error worth a dialog. */
async function svgToPng(svg: string, width: number, height: number): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))

  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('that page could not be drawn'))
      image.src = url
    })

    const paper = document.createElement('canvas')
    paper.width = Math.max(1, Math.round(width * 2))
    paper.height = Math.max(1, Math.round(height * 2))

    const ctx = paper.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(image, 0, 0, paper.width, paper.height)
    const blob = await new Promise<Blob | null>((resolve) => paper.toBlob(resolve, 'image/png'))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** One file handed over, wherever the app is: the chooser on a desktop, the
 *  browser's own save in a browser. One place, so the three formats below cannot
 *  behave differently about it. */
async function handOver(
  name: string,
  extension: string,
  label: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string | undefined> {
  const file = `${name}.${extension}`

  if (!isDesktop) {
    download(file, { bytes, mime })
    return file
  }

  const target = await chooseTarget(file, extension, label)
  if (!target) return

  await writeFile(target, bytes)
  return target
}

/** Every page as an SVG, in a zip. A zip and not a folder, because a page note is
 *  many pages and handing over forty downloads is not handing anything over. */
export async function exportPagesSvg(out: PagesOut): Promise<string | undefined> {
  const pages = pagesOf(out.canvas)
  if (!pages.length) return

  const name = stem(out.name)
  const zip = await zipOf(
    pages.map((page, at) => ({
      path: `${name}/${name} ${numbered(at + 1, pages.length)}.svg`,
      body: pageSvg(out, page, at + 1),
    })),
  )

  return handOver(`${name} pages`, 'zip', 'ZIP', zip, 'application/zip')
}

/** And every page as a PNG, at twice its size, in a zip. */
export async function exportPagesPng(out: PagesOut): Promise<string | undefined> {
  const pages = pagesOf(out.canvas)
  if (!pages.length) return

  const name = stem(out.name)
  const entries: { path: string; body: Uint8Array }[] = []

  for (const [at, page] of pages.entries()) {
    const bytes = await svgToPng(pageSvg(out, page, at + 1), page.width, page.height)
    if (!bytes) continue

    entries.push({ path: `${name}/${name} ${numbered(at + 1, pages.length)}.png`, body: bytes })
  }

  if (!entries.length) return

  return handOver(`${name} pages`, 'zip', 'ZIP', await zipOf(entries), 'application/zip')
}

/** The note as a PDF: the paper it was made from with the ink drawn on, or fresh
 *  pages where it was made from nothing.
 *
 *  A stroke becomes a filled path, which is what a stroke is: `outlineOf` gives the
 *  ring round it, and the same ring goes into the SVG, onto the screen and in here.
 *  So the three pictures of one stroke cannot drift.
 *
 *  PDF coordinates run up the page and a plane's run down it, so every `y` is
 *  subtracted from the page's height. That is the whole of the conversion: the units
 *  are the same, because a page's size in this format is already the size it would
 *  be printed. */
export async function exportPagesPdf(out: PagesOut): Promise<string | undefined> {
  const pages = pagesOf(out.canvas)
  if (!pages.length) return

  const { BlendMode, PDFDocument, rgb } = await import('pdf-lib')

  // The paper the pages came from, where they all came from one. A note whose pages
  // name several papers, or none, gets blank pages at its own sizes: the ink is what
  // is being exported either way, and this is about how much of the original comes
  // with it.
  const papers = new Set(pages.map((page) => page.file).filter((one): one is string => !!one))
  const source = papers.size === 1 ? [...papers][0] : null
  const bytes = source && out.root ? await paperBytes(joinPath(out.root, source)) : null

  const doc = bytes ? await PDFDocument.load(bytes) : await PDFDocument.create()
  const kept = bytes ? await doc.copyPages(doc, doc.getPageIndices()) : []
  const carried = doc.getPageCount()

  for (const [at, page] of pages.entries()) {
    // The page of the paper this sheet is a sheet of, where there is one and it is
    // still in the document; a sheet whose page has gone gets a blank one, so the
    // ink on it is never lost to a paper that changed under the note.
    const from =
      page.page !== undefined && page.page >= 1 && page.page <= carried ? page.page : null
    const sheet =
      from !== null && kept[from - 1]
        ? doc.insertPage(carried + at, kept[from - 1])
        : doc.insertPage(carried + at, [page.width, page.height])

    const { height } = sheet.getSize()

    for (const stroke of inkOn(out.canvas, page)) {
      const ring = outlineOf(stroke)
      if (ring.length < 2) continue

      const colour = hexOf(inkColour(stroke.color, out.palette))
      const path = ring
        .map((point, index) => {
          const x = (point.x - page.x).toFixed(2)
          const y = (height - (point.y - page.y)).toFixed(2)
          return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
        })
        .join(' ')

      sheet.drawSvgPath(`${path} Z`, {
        color: rgb(colour.r, colour.g, colour.b),
        opacity: inkOpacity(stroke),
        // The ring is the stroke: it is filled, never stroked, exactly as it is on
        // screen and in the SVG.
        borderWidth: 0,
        // A highlighter darkens what it crosses rather than covering it, which is
        // what a PDF blend mode is, and a marker over printed text is the reason a
        // page note made from a paper wants it.
        ...(INK_STYLES[stroke.tool].multiply ? { blendMode: BlendMode.Multiply } : {}),
      })
    }
  }

  // The pages that were copied in are gone from the front: what is wanted is one
  // sheet per page of the note, in the note's order, and a paper of forty pages that
  // the note uses three of should not carry the other thirty-seven.
  for (let index = carried - 1; index >= 0; index -= 1) doc.removePage(index)

  return handOver(stem(out.name), 'pdf', 'PDF', new Uint8Array(await doc.save()), 'application/pdf')
}

/** A colour as the three numbers pdf-lib wants, nought to one. Anything that is
 *  not a hex colour comes out black, which is what ink is. */
function hexOf(colour: string): { r: number; g: number; b: number } {
  const found = /^#?([\da-f]{6})$/i.exec(colour.trim())
  if (!found?.[1]) return { r: 0, g: 0, b: 0 }

  const value = Number.parseInt(found[1], 16)
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  }
}

/** The paper's bytes, or null where it is not there. A note whose PDF has gone
 *  still exports: the ink is the note's own and the paper was only ever underneath
 *  it. */
async function paperBytes(path: string): Promise<Uint8Array | null> {
  return await fileBytes(path).catch(() => null)
}
