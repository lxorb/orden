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
import { DEFAULT_INK, readPalette } from '../canvas/palette'
import { drawnNode, inlinedSvg, styles } from '../canvas/picture'
import { inkSvg } from '../canvas/svg'
import { type Box } from '../canvas/geometry'
import { fileBytes } from '../bytes'
import { chooseTarget, download, writeFile } from '../export/save'
import { zipOf } from '../export/zip'
import { PDF_TO_CSS } from '../pdf/pages'
import { isDesktop } from '../tauri'
import { paperPlaces } from './held'
import { laidOut, localFaces, type Run, type TextCard } from './laid'
import { cssColour, svgToPng } from './raster'
import { escapeAll } from '@nib/markdown/html'

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
  /** The text cards as the browser set them, by id; see `laidOf`. */
  laid?: ReadonlyMap<string, Run[]>
}

/** The export with its text cards laid out by the browser, as the plane lays them out
 *  (see laid.ts): every line where the card on screen has it, so what the sheet shows
 *  is what goes out. */
export async function laidOf(out: PagesOut): Promise<PagesOut> {
  if (out.laid) return out
  const cards = new Map<string, TextCard>()
  for (const page of pagesOf(out.canvas)) {
    for (const node of cardsOn(out.canvas, page)) {
      if (node.type === 'text' && node.text.trim()) cards.set(node.id, node)
    }
  }
  const laid = await laidOut([...cards.values()], {
    path: out.path,
    root: out.root,
    trusted: out.trusted ?? false,
  })
  return { ...out, laid }
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
    // stylesheet, so nothing in it can look `var(--canvas-1)` up any more. Its light
    // side whatever side is on, because the sheet is white (B571): a dark theme's pen
    // with no colour of its own writes near white, invisible on paper.
    palette: lightPalette(),
    path: open.path,
    root: open.root,
    name: open.name,
    trusted: open.trusted ?? false,
  }
}

/** The theme's colours as its light side has them, read off an element that asks for
 *  that side, as every theme answers `data-theme` on any element. */
function lightPalette(): Palette {
  const probe = document.createElement('div')
  probe.dataset.theme = 'light'
  probe.hidden = true
  document.body.append(probe)

  try {
    return readPalette(probe)
  } finally {
    probe.remove()
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

/** The palette a sheet that has left the app is drawn in: the light theme's (see
 *  `lightPalette`), on white, with the light theme's own values under it for whatever
 *  the palette does not say. */
function paperPalette(palette: Palette): Palette {
  return {
    [DEFAULT_INK]: '#0b0d10',
    text: '#1a1d23',
    line: '#d6d9de',
    dot: '#d5dce5',
    ...palette,
    surface: '#ffffff',
    bg: '#ffffff',
  }
}

/** The ruling pitches, as PagesPage.svelte draws them: 8mm lines and a 5mm grid at
 *  96 to the inch, a one pixel rule at the bottom of each pitch, and a dot of one
 *  pixel's radius in the middle of each square of the grid. */
const LINES = 30
const GRID = 19

/** A ruling as one SVG pattern, or nothing for a blank page. */
function rulingSvg(pattern: Pattern, width: number, rule: string): string {
  const tile = (w: number, h: number, body: string) =>
    `<pattern id="ruling" patternUnits="userSpaceOnUse" width="${w}" height="${h}">${body}</pattern>`
  switch (pattern) {
    case 'lines':
      return tile(
        width,
        LINES,
        `<rect y="${LINES - 1}" width="${width}" height="1" fill="${rule}"/>`,
      )
    case 'grid':
      return tile(
        GRID,
        GRID,
        `<rect y="${GRID - 1}" width="${GRID}" height="1" fill="${rule}"/><rect x="${GRID - 1}" width="1" height="${GRID}" fill="${rule}"/>`,
      )
    case 'dots':
      return tile(GRID, GRID, `<circle cx="${GRID / 2}" cy="${GRID / 2}" r="1" fill="${rule}"/>`)
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
 *  writes the page the way it would be printed, in the light theme's colours (see
 *  `pagesOutOf` and `paperPalette`).
 *
 *  `plain` is the picture a PNG is rasterised from: a browser will not hand over the
 *  pixels of an SVG with a `foreignObject` in it, so the cards are set as plain lines
 *  there, which is what the plane's own PNG does too. Exported for its tests. */
export function pageSvg(out: PagesOut, page: PageNode, index: number, plain = false): string {
  const strokes = inkOn(out.canvas, page).map((stroke) => moved(stroke, -page.x, -page.y))
  const palette = paperPalette(out.palette)
  const ink = inkSvg(strokes, palette)
  const label = `Page ${index}`

  // A sheet with a page of a paper behind it shows the paper over its ruling on screen.
  const ruling = page.file ? '' : rulingSvg(page.pattern, page.width, palette.dot ?? '')
  const cards = cardsOn(out.canvas, page)
    .map((node) =>
      plain && node.type === 'text'
        ? laidSvg(node, out.laid?.get(node.id) ?? [], palette)
        : drawnNode(node, palette, out.path, out.root, plain, out.trusted ?? false),
    )
    .join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}"`,
    ` viewBox="0 0 ${page.width} ${page.height}">`,
    `<title>${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`,
    cards ? `<style>${plain ? localFaces() : ''}${styles(palette)}</style>` : '',
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
export async function exportPagesPng(given: PagesOut): Promise<string | undefined> {
  const out = await laidOf(given)
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
export async function pagesPdf(given: PagesOut): Promise<Uint8Array | null> {
  const pages = pagesOf(given.canvas)
  if (!pages.length) return null
  const out = await laidOf(given)

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
  // Helvetica and Courier, which every reader has: the words stay text without a font
  // file in the export. Each embedded the first time a run asks for it.
  const fonts = facesFor(lib, doc)
  const glyphs = new Set(
    (await fonts({ weight: 400, italic: false, mono: false })).getCharacterSet(),
  )
  const palette = paperPalette(out.palette)

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
    const cards = cardsOn(out.canvas, page)
    // One at a time, so a sheet of a hundred shapes holds one canvas of pixels at once
    // rather than a hundred.
    const pictures: (Placed | null)[] = []
    for (const card of cards) pictures.push(await cardPdf(doc, card, out, palette, glyphs))
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
      if (ruled) sheet.pushOperators(...rulingPdf(lib, page, palette))
      for (const [index, card] of cards.entries()) {
        const placed = pictures[index]
        if (placed) {
          const { image, box } = placed
          sheet.drawImage(image, {
            x: box.x - page.x,
            y: -(box.y - page.y + box.height),
            width: box.width,
            height: box.height,
          })
        } else if (card.type === 'text') {
          await wordsPdf(lib, sheet, fonts, card, out.laid?.get(card.id) ?? [], page, palette)
        }
      }
      sheet.pushOperators(lib.popGraphicsState())
    }

    for (const stroke of inkOn(out.canvas, page)) {
      const ring = outlineOf(stroke)
      if (ring.length < 2) continue

      const colour = hexOf(inkColour(stroke.color, palette))
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
function rulingPdf(lib: PdfLib, page: PageNode, palette: Palette): import('pdf-lib').PDFOperator[] {
  const colour = hexOf(palette.dot ?? '')
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

/** What a card that is not words the PDF font can spell puts on its sheet: the plane's
 *  own plain picture of it (canvas/picture.ts), rasterised by the browser as the PNG
 *  export is. That is a shape, a link, a picture, and words in a script Helvetica has
 *  no glyphs for - Polish, Cyrillic, Greek, CJK, emoji - which would otherwise be on
 *  the screen and missing from paper. Null for a card that is set as text, or one the
 *  browser would not draw: a card of words then keeps the letters the font has. */
/** A card's picture and the box it covers on the plane. */
interface Placed {
  image: import('pdf-lib').PDFImage
  box: Box
}

async function cardPdf(
  doc: import('pdf-lib').PDFDocument,
  card: CanvasNode,
  out: PagesOut,
  palette: Palette,
  glyphs: ReadonlySet<number>,
): Promise<Placed | null> {
  const runs = card.type === 'text' ? (out.laid?.get(card.id) ?? []) : []
  if (card.type === 'text') {
    const spelled = runs.every((run) =>
      Array.from(run.text).every((one) => glyphs.has(one.codePointAt(0) ?? -1)),
    )
    if (spelled) return null
  }

  // A group's name sits above its box (see `drawnNode`), so its picture reaches up to it.
  const above = card.type === 'group' && card.label ? 24 : 0
  const box = { x: card.x, y: card.y - above, width: card.width, height: card.height + above }
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"`,
    ` viewBox="${box.x} ${box.y} ${box.width} ${box.height}">`,
    `<style>${localFaces()}${styles(palette)}</style>`,
    card.type === 'text'
      ? laidSvg(card, runs, palette)
      : drawnNode(card, palette, out.path, out.root, true, out.trusted ?? false),
    '</svg>',
  ].join('')
  const png = await svgToPng(await inlinedSvg(svg), box.width, box.height).catch(() => null)

  return png ? { image: await doc.embedPng(png), box } : null
}

/** A text card as SVG for a picture, as the browser set it (see laid.ts): its frame
 *  where it has one, and each of its lines where it is, in its face, size and colour,
 *  held to the width the browser gave it - so a picture that finds another face for a
 *  script still puts every word where the card has it. Cut to the card, as the plane
 *  cuts a card's overflow: a nested viewport clips what runs past it. */
function laidSvg(card: TextCard, runs: readonly Run[], palette: Palette): string {
  const look = frameOf(card, palette)
  const d = framePath(card.x, card.y, card.width, card.height)
  const frame = look
    ? `<path d="${d}" fill="#ffffff"/>${look.wash ? `<path d="${d}" fill="${look.wash}" fill-opacity="0.09"/>` : ''}<path d="${d}" fill="none" stroke="${look.edge}"/>`
    : ''
  const lines = runs
    .map(
      (run) =>
        `<text font-family="${escapeAll(run.family)}" font-size="${run.size}" font-weight="${run.weight}"${run.italic ? ' font-style="italic"' : ''} fill="${escapeAll(run.colour)}" textLength="${round(run.width)}" lengthAdjust="spacingAndGlyphs"><tspan x="${round(card.x + run.x)}" y="${round(card.y + run.y)}">${escapeAll(run.text)}</tspan></text>`,
    )
    .join('')

  return `<g>${frame}<svg x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" viewBox="${card.x} ${card.y} ${card.width} ${card.height}" overflow="hidden">${lines}</svg></g>`
}

/** A coordinate to a hundredth of a pixel, which is finer than any screen. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** How a framed card's frame looks, as the plane draws it: its edge in the card's
 *  colour, or the theme's line where it has none, and a faint wash of the colour inside.
 *  Null for bare words, which have no frame. */
function frameOf(
  card: CanvasNode & { type: 'text' },
  palette: Palette,
): { edge: string; wash: string | null } | null {
  if (card.bare) return null
  if (card.color === undefined) return { edge: palette.line ?? '', wash: null }
  const colour = inkColour(card.color, palette)
  return { edge: colour, wash: colour }
}

/** A card's frame as a path: its rounded box, half a pixel inside its edge so the
 *  whole of a one pixel stroke is inside the card and inside its picture. */
function framePath(x: number, y: number, width: number, height: number): string {
  const r = 8
  const [l, t, rt, b] = [x + 0.5, y + 0.5, x + width - 0.5, y + height - 0.5]
  return [
    `M ${l + r} ${t} L ${rt - r} ${t} Q ${rt} ${t} ${rt} ${t + r}`,
    `L ${rt} ${b - r} Q ${rt} ${b} ${rt - r} ${b}`,
    `L ${l + r} ${b} Q ${l} ${b} ${l} ${b - r}`,
    `L ${l} ${t + r} Q ${l} ${t} ${l + r} ${t} Z`,
  ].join(' ')
}

/** The standard face a run is printed in: Courier for code, Helvetica for the rest,
 *  bold and slanted as the run is. Each embedded the first time it is asked for. */
function facesFor(lib: PdfLib, doc: import('pdf-lib').PDFDocument) {
  const embedded = new Map<string, Promise<Font>>()
  return (run: Pick<Run, 'weight' | 'italic' | 'mono'>): Promise<Font> => {
    const bold = run.weight >= 600
    const name = run.mono
      ? bold
        ? run.italic
          ? lib.StandardFonts.CourierBoldOblique
          : lib.StandardFonts.CourierBold
        : run.italic
          ? lib.StandardFonts.CourierOblique
          : lib.StandardFonts.Courier
      : bold
        ? run.italic
          ? lib.StandardFonts.HelveticaBoldOblique
          : lib.StandardFonts.HelveticaBold
        : run.italic
          ? lib.StandardFonts.HelveticaOblique
          : lib.StandardFonts.Helvetica
    let font = embedded.get(name)
    if (!font) embedded.set(name, (font = doc.embedFont(name)))
    return font
  }
}

/** One card's words as real PDF text in the page's frame, line by line where the
 *  browser set them (see laid.ts): each run at its place and baseline, in the standard
 *  face nearest its own, squeezed or stretched (`Tz`) to the width the browser gave it,
 *  so a line takes exactly the room it takes on screen whatever Helvetica's widths
 *  are. Clipped to the card as the plane clips it; a card with a frame on screen gets
 *  its frame.
 *
 *  Only for words the font can spell (see `cardPdf`); where the browser refused the
 *  picture of a card that is not, the letters the font has are what is left. */
async function wordsPdf(
  lib: PdfLib,
  sheet: Sheet,
  fonts: (run: Run) => Promise<Font>,
  card: TextCard,
  runs: readonly Run[],
  page: PageNode,
  palette: Palette,
) {
  const left = card.x - page.x
  const top = card.y - page.y

  sheet.pushOperators(
    lib.pushGraphicsState(),
    lib.rectangle(left, -(top + card.height), card.width, card.height),
    lib.clip(),
    lib.endPath(),
  )

  const look = frameOf(card, palette)
  if (look) {
    // The frame the picture of a card has (see `laidSvg`), in the page's frame: an
    // SVG path is drawn with `y` down about the origin it is given, which is the page's.
    const d = framePath(left, top, card.width, card.height)
    sheet.drawSvgPath(d, { x: 0, y: 0, color: rgb1(lib, hexOf('#ffffff')), borderWidth: 0 })
    if (look.wash) {
      sheet.drawSvgPath(d, {
        x: 0,
        y: 0,
        color: rgb1(lib, hexOf(look.wash)),
        opacity: 0.09,
        borderWidth: 0,
      })
    }
    sheet.drawSvgPath(d, { x: 0, y: 0, borderColor: rgb1(lib, hexOf(look.edge)), borderWidth: 1 })
  }

  for (const run of runs) {
    const font = await fonts(run)
    const glyphs = new Set(font.getCharacterSet())
    const text = Array.from(run.text)
      .filter((one) => glyphs.has(one.codePointAt(0) ?? -1))
      .join('')
    if (!text.trim()) continue

    const natural = font.widthOfTextAtSize(text, run.size)
    const squeeze = natural > 0 ? (run.width / natural) * 100 : 100
    const colour = hexOf(run.colour)
    const key = sheet.node.newFontDictionary(font.name, font.ref)
    sheet.pushOperators(
      lib.pushGraphicsState(),
      lib.setFillingRgbColor(colour.r, colour.g, colour.b),
      lib.beginText(),
      lib.setFontAndSize(key, run.size),
      lib.setCharacterSqueeze(round(squeeze)),
      lib.setTextMatrix(1, 0, 0, 1, round(left + run.x), round(-(top + run.y))),
      lib.showText(font.encodeText(text)),
      lib.endText(),
      lib.popGraphicsState(),
    )
  }

  sheet.pushOperators(lib.popGraphicsState())
}

function rgb1(lib: PdfLib, colour: { r: number; g: number; b: number }) {
  return lib.rgb(colour.r, colour.g, colour.b)
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

/** A colour as the three numbers pdf-lib wants, nought to one. Anything that is not
 *  a colour comes out black, which is what ink is. */
function hexOf(colour: string): { r: number; g: number; b: number } {
  // A theme may give a colour in any CSS form; the browser says it as hex or rgb().
  const said = cssColour(colour.trim())
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(said)
  if (rgb) {
    const [r, g, b] = rgb.slice(1, 4).map((one) => Math.min(255, Number(one)) / 255)
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0 }
  }

  const found = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(said)
  if (!found?.[1]) return { r: 0, g: 0, b: 0 }

  // `#f00` is `#ff0000`.
  const six = found[1].length === 3 ? found[1].replace(/./g, '$&$&') : found[1]
  const value = Number.parseInt(six, 16)
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
