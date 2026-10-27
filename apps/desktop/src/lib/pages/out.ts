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
 *  **What is on a page goes out with it.** The ink, the words typed onto it and the
 *  cards put on it, and the ruling it is printed with (B541): the reader sees all of
 *  them on the sheet, so a sheet that has left the app shows all of them. The cards are
 *  the plane's own picture of a card (canvas/picture.ts) in the SVG and the PNG, and
 *  real text in the PDF, so the words there are still words a reader can find.
 *
 *  The ink goes into the page's own content and not into an `/Ink` annotation. Both
 *  would be the same strokes twice, and of the two, content is the one every reader
 *  and every printer draws: pdf-lib has no annotation writer of its own, and ink
 *  only a reader that renders annotations can see is ink that prints as a blank
 *  page. What that costs is that the strokes cannot be rubbed out again in another
 *  app - which is what the page note holding the paper is for, and why the paper
 *  is never written over.
 *
 *  pdf-lib is loaded when an export runs and not before, like the rest of the
 *  export's libraries. */

import { onPage, pagesOf } from '@nib/markdown/pages'
import {
  type Canvas,
  type CanvasNode,
  type InkStroke,
  type PageNode,
  type Pattern,
  readCanvas,
} from '../canvas/format'
import { INK_STYLES, inkOpacity, outlineOf } from '../canvas/ink'
import { inkColour, type Palette } from '../canvas/paint'
import { readPalette } from '../canvas/palette'
import { cardType, drawnNode, inlinedSvg, plainLines, styles } from '../canvas/picture'
import { inkSvg } from '../canvas/svg'
import { fileBytes } from '../bytes'
import { chooseTarget, download, writeFile } from '../export/save'
import { zipOf } from '../export/zip'
import { PDF_TO_CSS } from '../pdf/pages'
import { isDesktop } from '../tauri'
import { paperPlaces } from './held'

/** What an export of a page note is about. */
export interface PagesOut {
  canvas: Canvas
  palette: Palette
  /** The note's own path, so the PDF its pages name can be found beside it. */
  path: string | null
  root: string | null
  name: string
  /** Whether the cards' HTML is markup rather than the characters it is made of,
   *  asked the way the page on screen asks it; see trust.ts. */
  trusted?: boolean
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
  trusted?: boolean
}): PagesOut {
  return {
    canvas: readCanvas(open.text),
    // The theme's own colours as colours: a file that has left the app carries no
    // stylesheet, so nothing in it can look `var(--canvas-1)` up any more.
    palette: readPalette(document.documentElement),
    path: open.path,
    root: open.root,
    name: open.name,
    trusted: open.trusted ?? false,
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

/** The cards on one page: every node but a page that overlaps it, in the plane's
 *  order. Overlaps and not "starts on", because a card that runs over the edge of a
 *  sheet shows on both on screen, and each sheet is clipped to itself. */
function cardsOn(canvas: Canvas, page: PageNode): CanvasNode[] {
  return canvas.nodes.filter(
    (node) =>
      node.type !== 'page' &&
      node.x + node.width > page.x &&
      node.x < page.x + page.width &&
      node.y + node.height > page.y &&
      node.y < page.y + page.height,
  )
}

/** The words and the rules on a sheet that has left the app, in the colours of white
 *  paper: the light theme's text and `--canvas-dot`. The theme on screen may be dark,
 *  and its light words would be invisible on a white sheet. */
const PAPER_TEXT = '#1a1d23'
const PAPER_RULE = '#d5dce5'

function paperPalette(palette: Palette): Palette {
  return { ...palette, text: PAPER_TEXT, surface: '#ffffff', bg: '#ffffff', line: '#d6d9de' }
}

/** The ruling pitches, as PagesPage.svelte draws them: 8mm lines and a 5mm grid at
 *  96 to the inch, a one pixel rule at the bottom of each pitch, and a dot of one
 *  pixel's radius in the middle of each square of the grid. */
const LINES = 30
const GRID = 19

/** A ruling as one SVG pattern, or nothing for a blank page. */
function rulingSvg(pattern: Pattern, width: number): string {
  const tile = (w: number, h: number, body: string) =>
    `<pattern id="ruling" patternUnits="userSpaceOnUse" width="${w}" height="${h}">${body}</pattern>`
  switch (pattern) {
    case 'lines':
      return tile(
        width,
        LINES,
        `<rect y="${LINES - 1}" width="${width}" height="1" fill="${PAPER_RULE}"/>`,
      )
    case 'grid':
      return tile(
        GRID,
        GRID,
        `<rect y="${GRID - 1}" width="${GRID}" height="1" fill="${PAPER_RULE}"/><rect x="${GRID - 1}" width="1" height="${GRID}" fill="${PAPER_RULE}"/>`,
      )
    case 'dots':
      return tile(
        GRID,
        GRID,
        `<circle cx="${GRID / 2}" cy="${GRID / 2}" r="1" fill="${PAPER_RULE}"/>`,
      )
    case 'blank':
      return ''
  }
}

/** One page as an SVG, in the page's own coordinates: the origin at its top left,
 *  and everything on it moved so a stroke drawn half way down the third page is half
 *  way down its own picture. The ruling, then the cards, then the ink, which is the
 *  order the page on screen stacks them in.
 *
 *  White paper, because paper is white. A page note honours the theme on screen -
 *  that is what a screen is for - and a sheet that has left the app is a sheet: ink
 *  that was drawn light on a dark page would be invisible on it, so the export
 *  writes the page the way it would be printed.
 *
 *  `plain` is the picture a PNG is rasterised from: a browser will not hand over the
 *  pixels of an SVG with a `foreignObject` in it, so the cards are set as plain lines
 *  there, which is what the plane's own PNG does too. Exported for its tests. */
export function pageSvg(out: PagesOut, page: PageNode, index: number, plain = false): string {
  const strokes = inkOn(out.canvas, page).map((stroke) => moved(stroke, -page.x, -page.y))
  const ink = inkSvg(strokes, out.palette)
  const label = `Page ${index}`
  const palette = paperPalette(out.palette)

  // A sheet with a page of a paper behind it shows the paper over its ruling on screen.
  const ruling = page.file ? '' : rulingSvg(page.pattern, page.width)
  const cards = cardsOn(out.canvas, page)
    .map((node) => drawnNode(node, palette, out.path, out.root, plain, out.trusted ?? false))
    .join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}"`,
    ` viewBox="0 0 ${page.width} ${page.height}">`,
    `<title>${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`,
    cards ? `<style>${styles(palette)}</style>` : '',
    `<defs><clipPath id="sheet"><rect width="${page.width}" height="${page.height}"/></clipPath>${ruling}</defs>`,
    `<rect width="${page.width}" height="${page.height}" fill="#ffffff"/>`,
    ruling ? `<rect width="${page.width}" height="${page.height}" fill="url(#ruling)"/>` : '',
    cards
      ? `<g clip-path="url(#sheet)"><g transform="translate(${-page.x} ${-page.y})">${cards}</g></g>`
      : '',
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
    await Promise.all(
      pages.map(async (page, at) => ({
        path: `${name}/${name} ${numbered(at + 1, pages.length)}.svg`,
        body: await inlinedSvg(pageSvg(out, page, at + 1)),
      })),
    ),
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
    const svg = await inlinedSvg(pageSvg(out, page, at + 1, true))
    const bytes = await svgToPng(svg, page.width, page.height)
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
 *  A page is in CSS pixels and a sheet in points, turned as its paper is turned; see
 *  `pagesPdf` for the one transform that is a page on its sheet. */
export async function exportPagesPdf(out: PagesOut): Promise<string | undefined> {
  const bytes = await pagesPdf(out)
  if (!bytes) return

  return handOver(stem(out.name), 'pdf', 'PDF', bytes, 'application/pdf')
}

/** The note's PDF, as bytes: what the export above writes and what printing puts on
 *  paper, so the two cannot differ. Null for a note with no pages. */
export async function pagesPdf(out: PagesOut): Promise<Uint8Array | null> {
  const pages = pagesOf(out.canvas)
  if (!pages.length) return null

  const lib = await import('pdf-lib')
  const { BlendMode, degrees, PDFDocument, rgb } = lib

  // The paper the pages came from, where they all came from one. A note whose pages
  // name several papers, or none, gets blank pages at its own sizes: the ink is what
  // is being exported either way, and this is about how much of the original comes
  // with it.
  const papers = new Set(pages.map((page) => page.file).filter((one): one is string => !!one))
  const source = papers.size === 1 ? [...papers][0] : null
  const bytes = source ? await paperBytes(paperPlaces(source, out.path, out.root)) : null

  const doc = bytes ? await PDFDocument.load(bytes) : await PDFDocument.create()
  const kept = bytes ? await doc.copyPages(doc, doc.getPageIndices()) : []
  const carried = doc.getPageCount()
  // Helvetica, which every reader has: the words stay text without a font file in
  // the export. Embedded only for a note with words in it.
  const words = out.canvas.nodes.some((node) => node.type === 'text' && node.text.trim())
  const font = words ? await doc.embedFont(lib.StandardFonts.Helvetica) : null

  for (const [at, page] of pages.entries()) {
    // The page of the paper this sheet is a sheet of, where there is one and it is
    // still in the document; a sheet whose page has gone gets a blank one, so the
    // ink on it is never lost to a paper that changed under the note.
    const from =
      page.page !== undefined && page.page >= 1 && page.page <= carried ? page.page : null
    const sheet =
      from !== null && kept[from - 1]
        ? doc.insertPage(carried + at, kept[from - 1])
        : doc.insertPage(carried + at, [page.width / PDF_TO_CSS, page.height / PDF_TO_CSS])

    // The page is the sheet as pdf.js shows it, which is how its size was read: the
    // crop box turned by /Rotate. So the ink is scaled from pixels to that box's points,
    // turned with it, and put at the corner that is then the top left.
    const box = sheet.getCropBox()
    const turn = ((sheet.getRotation().angle % 360) + 360) % 360
    const scale = (turn % 180 ? box.height : box.width) / page.width
    const x = box.x + (turn >= 180 ? box.width : 0)
    const y = box.y + (turn === 0 || turn === 270 ? box.height : 0)

    // The ruling and the words, under the ink as on screen. The ruling only on a sheet
    // of its own: a page of a paper covers its ruling on screen too.
    const ruled = from === null && page.pattern !== 'blank'
    const cards = font ? cardsOn(out.canvas, page) : []
    const palette = paperPalette(out.palette)
    if (ruled || cards.length) {
      sheet.pushOperators(
        lib.pushGraphicsState(),
        // The page's own frame: its top left at the origin, in its pixels, `y` up the
        // page as everything in a PDF is - so a point of the page is (x, -y).
        lib.translate(x, y),
        lib.rotateDegrees(turn),
        lib.scale(scale, scale),
        lib.rectangle(0, -page.height, page.width, page.height),
        lib.clip(),
        lib.endPath(),
      )
      if (ruled) sheet.pushOperators(...rulingPdf(lib, page))
      if (font) for (const card of cards) wordsPdf(lib, sheet, font, card, page, palette)
      sheet.pushOperators(lib.popGraphicsState())
    }

    for (const stroke of inkOn(out.canvas, page)) {
      const ring = outlineOf(stroke)
      if (ring.length < 2) continue

      const colour = hexOf(inkColour(stroke.color, out.palette))
      const path = ring
        .map((point, index) => {
          const x = (point.x - page.x).toFixed(2)
          const y = (point.y - page.y).toFixed(2)
          return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
        })
        .join(' ')

      // An SVG path runs down the page and pdf-lib turns it up the page itself, about
      // the origin it is given: so the path is the plane's own `y`, and the origin is the
      // top of the sheet. Turned twice, the ink landed below the sheet, off the page.
      sheet.drawSvgPath(`${path} Z`, {
        x,
        y,
        rotate: degrees(turn),
        scale,
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

  return new Uint8Array(await doc.save())
}

type PdfLib = typeof import('pdf-lib')
type Sheet = import('pdf-lib').PDFPage
type Font = import('pdf-lib').PDFFont

/** A page's ruling as PDF operators in the page's frame (see `pagesPdf`): the rules
 *  as thin filled bars, and the dots as squares a pixel and a half across - at that
 *  size a square is a dot on any paper, and two thousand of them stay a small page. */
function rulingPdf(lib: PdfLib, page: PageNode): import('pdf-lib').PDFOperator[] {
  const colour = hexOf(PAPER_RULE)
  const ops = [lib.setFillingRgbColor(colour.r, colour.g, colour.b)]
  const bar = (left: number, top: number, w: number, h: number) =>
    ops.push(lib.rectangle(left, -(top + h), w, h))

  if (page.pattern === 'lines') {
    for (let at = LINES - 1; at < page.height; at += LINES) bar(0, at, page.width, 1)
  } else if (page.pattern === 'grid') {
    for (let at = GRID - 1; at < page.height; at += GRID) bar(0, at, page.width, 1)
    for (let at = GRID - 1; at < page.width; at += GRID) bar(at, 0, 1, page.height)
  } else if (page.pattern === 'dots') {
    for (let top = GRID / 2; top < page.height; top += GRID) {
      for (let left = GRID / 2; left < page.width; left += GRID)
        bar(left - 0.75, top - 0.75, 1.5, 1.5)
    }
  }

  ops.push(lib.fill())
  return ops
}

/** One card's words as real PDF text in the page's frame: broken to the card's width
 *  with the font's own widths, at the size and inside the padding the plane sets them
 *  in, and clipped to the card as the plane clips it. A card with a frame on screen
 *  gets its frame. Only text cards: a picture, a link or a shape on a page is not
 *  drawn into the PDF yet.
 *
 *  A character Helvetica has no glyph for is left out rather than failing the whole
 *  export; that is the cost of a font every reader already has. */
function wordsPdf(
  lib: PdfLib,
  sheet: Sheet,
  font: Font,
  card: CanvasNode,
  page: PageNode,
  palette: Palette,
) {
  if (card.type !== 'text' || !card.text.trim()) return

  const type = cardType(!!card.bare)
  // The plane's line height, which is 1.55.
  const line = type.size * 1.55
  const left = card.x - page.x
  const top = card.y - page.y
  const colour = hexOf(
    card.bare && card.color !== undefined ? inkColour(card.color, palette) : PAPER_TEXT,
  )
  const glyphs = new Set(font.getCharacterSet())
  const fits = (text: string) => font.widthOfTextAtSize(text, type.size)
  const lines = plainLines(card.text).flatMap((line) =>
    broken(
      line.replace(/[\s\S]/gu, (one) => (glyphs.has(one.codePointAt(0) ?? -1) ? one : '')),
      card.width - 2 * type.padX,
      fits,
    ),
  )

  sheet.pushOperators(
    lib.pushGraphicsState(),
    lib.rectangle(left, -(top + card.height), card.width, card.height),
    lib.clip(),
    lib.endPath(),
  )

  if (!card.bare) {
    const edge = hexOf(palette.line ?? '#d6d9de')
    sheet.drawRectangle({
      x: left,
      y: -(top + card.height),
      width: card.width,
      height: card.height,
      color: rgb1(lib, hexOf('#ffffff')),
      borderColor: rgb1(lib, edge),
      borderWidth: 1,
    })
  }

  for (const [index, text] of lines.entries()) {
    if (!text) continue
    // A little under the middle of the line box, as the plane's picture sets it.
    const baseline = top + type.padY + (line + type.size) / 2 - 3 + index * line
    if (baseline - type.size > top + card.height) break
    sheet.drawText(text, {
      x: left + type.padX,
      y: -baseline,
      size: type.size,
      font,
      color: rgb1(lib, colour),
    })
  }

  sheet.pushOperators(lib.popGraphicsState())
}

function rgb1(lib: PdfLib, colour: { r: number; g: number; b: number }) {
  return lib.rgb(colour.r, colour.g, colour.b)
}

/** One line broken to a width, at the spaces where it can be and inside a word where
 *  a word is wider than the line, which is what the plane's `overflow-wrap` does. */
function broken(line: string, width: number, fits: (text: string) => number): string[] {
  const out: string[] = []
  let rest = line.trimEnd()

  while (rest && fits(rest) > width) {
    let cut = rest.length
    while (cut > 1 && fits(rest.slice(0, cut)) > width) cut -= 1
    const space = rest.lastIndexOf(' ', cut)
    const at = space > 0 ? space : cut
    out.push(rest.slice(0, at))
    rest = rest.slice(space > 0 ? at + 1 : at)
  }

  out.push(rest)
  return out
}

/** How finely a page is drawn for the printer, against its size on screen: twice,
 *  which is near two hundred dots to the inch - sharper than ink on paper needs, and a
 *  long note still a sheet of pictures the print engine takes without a pause. */
const PRINT_SCALE = 2

/** The note on paper, through whatever print dialog the machine has (#350).
 *
 *  The PDF the export writes, drawn a page at a time and handed to the print engine
 *  as one picture per sheet: the paper the note was made from, the ink on it and the
 *  page sizes are all exactly the export's, and a print engine that cannot open a PDF
 *  itself - a browser's frame, WebKit's - still prints pictures. `printInFrame` is the
 *  system's own dialog on every desktop and the browser's in a browser. */
export async function printPages(out: PagesOut): Promise<void> {
  const bytes = await pagesPdf(out)
  if (!bytes) return

  const [{ pdfjs }, { printInFrame }] = await Promise.all([
    import('../pdf/document'),
    import('../export'),
  ])
  const library = await pdfjs()
  const task = library.getDocument({ data: bytes })
  const doc = await task.promise
  const sheets: { src: string; width: number; height: number }[] = []

  try {
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number)
      const natural = page.getViewport({ scale: PDF_TO_CSS })
      const viewport = page.getViewport({ scale: PDF_TO_CSS * PRINT_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      const context = canvas.getContext('2d')
      if (context) {
        await page.render({ canvas, canvasContext: context, viewport }).promise
        sheets.push({
          src: canvas.toDataURL('image/png'),
          width: natural.width,
          height: natural.height,
        })
      }
      page.cleanup()
    }
  } finally {
    await task.destroy().catch(() => undefined)
  }

  const first = sheets[0]
  if (!first) return

  // One sheet of the first page's size, which is the paper the dialog opens on; a
  // page of another size is fitted onto it whole rather than cut.
  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${escaped(stem(out.name))}</title><style>`,
    `@page{size:${first.width}px ${first.height}px;margin:0}`,
    'html,body{margin:0;padding:0;background:#fff}',
    '.sheet{display:flex;align-items:center;justify-content:center;',
    `width:${first.width}px;height:${first.height}px;break-after:page;overflow:hidden}`,
    '.sheet:last-child{break-after:auto}',
    'img{display:block;max-width:100%;max-height:100%}',
    '</style></head><body>',
    ...sheets.map(
      (one, index) =>
        `<div class="sheet"><img src="${one.src}" alt="Page ${index + 1}" width="${Math.round(one.width)}" height="${Math.round(one.height)}"></div>`,
    ),
    '</body></html>',
  ].join('')

  await printInFrame(html, {
    width: first.width / 96,
    height: first.height / 96,
    margin: 0,
    landscape: false,
  })
}

function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

/** The paper's bytes, from the first of its places that answers - the paper the note
 *  holds, then where the page's name points, as the sheet on screen reads it (see
 *  held.ts) - or null where it is in none of them. A note whose PDF has gone still
 *  exports: the ink is the note's own and the paper was only ever underneath it. */
async function paperBytes(places: readonly string[]): Promise<Uint8Array | null> {
  for (const path of places) {
    const bytes = await fileBytes(path).catch(() => null)
    if (bytes) return bytes
  }
  return null
}
