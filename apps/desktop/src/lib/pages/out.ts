import { onPage, pagesOf } from '@orden/markdown/pages'
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
import { DEFAULT_INK, paletteOf } from '../canvas/palette'
import { drawnNode, inlinedSvg, styles } from '../canvas/picture'
import { inkSvg } from '../canvas/svg'
import { type Box } from '../canvas/geometry'
import { busy } from '../busy.svelte'
import { pngData } from '../png-off'
import { fileBytes } from '../bytes'
import { chooseTarget, download, writeFile } from '../export/save'
import { zipOf } from '../export/zip'
import { PDF_TO_CSS } from '../pdf/pages'
import { t } from '../i18n.svelte'
import { isDesktop } from '../tauri'
import { paperPlaces } from './held'
import { laidOut, localFaces, type Run, type TextCard } from './laid'
import { cssColour, paperIsLocked, paperPicture, paperUnder, sharpness, svgToPng } from './raster'
import { escapeAll } from '@orden/markdown/html'

function saidLocked(): void {
  busy.failed(t('This PDF is locked by its owner'))
}

export interface PagesOut {
  canvas: Canvas
  palette: Palette
  path: string | null
  root: string | null
  shared?: string | null
  name: string
  trusted?: boolean
  laid?: ReadonlyMap<string, Run[]>
}

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

export function pagesOutOf(open: {
  text: string
  name: string
  path: string | null
  root: string | null
  shared?: string | null
  trusted?: boolean
}): PagesOut {
  return {
    canvas: readCanvas(open.text),
    palette: paletteOf('light'),
    path: open.path,
    root: open.root,
    shared: open.shared ?? null,
    name: open.name,
    trusted: open.trusted ?? false,
  }
}

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'Pages'
}

function numbered(at: number, of: number): string {
  return String(at).padStart(String(of).length, '0')
}

function inkOn(canvas: Canvas, page: PageNode): InkStroke[] {
  const box = { x: page.x, y: page.y, width: page.width, height: page.height }
  return canvas.ink.filter((stroke) => onPage(stroke, box))
}

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

const LINES = 30
const GRID = 19
const SHEET = LINES * GRID * 33

function sheetsOf(pages: readonly PageNode[]): PageNode[] {
  return pages.flatMap((page) => {
    if (page.file || page.height <= SHEET) return [page]
    return Array.from({ length: Math.ceil(page.height / SHEET) }, (_, at) => ({
      ...page,
      y: page.y + at * SHEET,
      height: Math.min(SHEET, page.height - at * SHEET),
    }))
  })
}

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

export function pageSvg(
  out: PagesOut,
  page: PageNode,
  index: number,
  plain = false,
  paper: string | null = null,
  ground = true,
): string {
  const strokes = inkOn(out.canvas, page).map((stroke) => moved(stroke, -page.x, -page.y))
  const palette = paperPalette(out.palette)
  const ink = inkSvg(strokes, palette)
  const label = `Page ${index}`

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
    ground ? `<rect width="${page.width}" height="${page.height}" fill="#ffffff"/>` : '',
    paper
      ? `<image href="${paper}" width="${page.width}" height="${page.height}" preserveAspectRatio="none"/>`
      : '',
    ruling ? `<rect width="${page.width}" height="${page.height}" fill="url(#ruling)"/>` : '',
    cards
      ? `<g clip-path="url(#sheet)"><g transform="translate(${-page.x} ${-page.y})">${cards}</g></g>`
      : '',
    ink,
    '</svg>',
  ].join('')
}

async function paperAt(out: PagesOut, page: PageNode) {
  if (!page.file || page.page === undefined) return null
  const at = { file: page.file, note: out.path, root: out.root, shared: out.shared ?? null }
  if (await paperIsLocked(at)) {
    saidLocked()
    return null
  }
  return { at, number: page.page }
}

async function paperBehind(out: PagesOut, page: PageNode): Promise<string | null> {
  const paper = await paperAt(out, page)
  return paper ? paperPicture(paper.at, paper.number) : null
}

function moved(stroke: InkStroke, byX: number, byY: number): InkStroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({ ...point, x: point.x + byX, y: point.y + byY })),
  }
}

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

export async function exportPagesSvg(out: PagesOut): Promise<string | undefined> {
  const pages = sheetsOf(pagesOf(out.canvas))
  if (!pages.length) return

  const name = stem(out.name)
  const entries: { path: string; body: string }[] = []
  for (const [at, page] of pages.entries()) {
    entries.push({
      path: `${name}/${name} ${numbered(at + 1, pages.length)}.svg`,
      body: await inlinedSvg(pageSvg(out, page, at + 1, false, await paperBehind(out, page))),
    })
  }
  const zip = await zipOf(entries)

  return handOver(`${name} pages`, 'zip', 'ZIP', zip, 'application/zip')
}

export async function exportPagesPng(given: PagesOut): Promise<string | undefined> {
  const out = await laidOf(given)
  const pages = sheetsOf(pagesOf(out.canvas))
  if (!pages.length) return

  const name = stem(out.name)
  const entries: { path: string; body: Uint8Array }[] = []

  for (const [at, page] of pages.entries()) {
    const paper = await paperAt(out, page)
    const svg = await inlinedSvg(pageSvg(out, page, at + 1, true, null, !paper))
    const under = paper ? () => paperUnder(paper.at, paper.number) : null
    const bytes = await svgToPng(svg, page.width, page.height, under)
    if (!bytes) continue

    entries.push({ path: `${name}/${name} ${numbered(at + 1, pages.length)}.png`, body: bytes })
  }

  if (!entries.length) return

  return handOver(`${name} pages`, 'zip', 'ZIP', await zipOf(entries), 'application/zip')
}

export async function exportPagesPdf(out: PagesOut): Promise<string | undefined> {
  const bytes = await pagesPdf(out)
  if (!bytes) return

  return handOver(stem(out.name), 'pdf', 'PDF', bytes, 'application/pdf')
}

export async function pagesPdf(given: PagesOut): Promise<Uint8Array | null> {
  const pages = sheetsOf(pagesOf(given.canvas))
  if (!pages.length) return null
  const out = await laidOf(given)

  const lib = await import('pdf-lib')
  const { BlendMode, degrees, PDFDocument, rgb } = lib

  const papers = new Set(pages.map((page) => page.file).filter((one): one is string => !!one))
  const source = papers.size === 1 ? [...papers][0] : null
  const bytes = source ? await paperBytes(paperPlaces(source, out.path, out.root)) : null

  const opened = bytes ? await PDFDocument.load(bytes, { ignoreEncryption: true }) : null
  if (opened?.isEncrypted) {
    saidLocked()
    return null
  }
  const doc = opened ?? (await PDFDocument.create())
  const kept = opened ? await doc.copyPages(doc, doc.getPageIndices()) : []
  const used = new Set<number>()
  const carried = doc.getPageCount()
  const fonts = facesFor(lib, doc)
  const glyphs = new Set(
    (await fonts({ weight: 400, italic: false, mono: false })).getCharacterSet(),
  )
  const palette = paperPalette(out.palette)

  for (const [at, page] of pages.entries()) {
    const from =
      page.page !== undefined && page.page >= 1 && page.page <= carried ? page.page : null
    const copy =
      from === null
        ? undefined
        : used.has(from)
          ? (await doc.copyPages(doc, [from - 1]))[0]
          : kept[from - 1]
    if (from !== null && copy) used.add(from)
    const sheet = copy
      ? doc.insertPage(carried + at, copy)
      : doc.insertPage(carried + at, [page.width / PDF_TO_CSS, page.height / PDF_TO_CSS])

    const box = sheet.getCropBox()
    const turn = ((sheet.getRotation().angle % 360) + 360) % 360
    const scale = (turn % 180 ? box.height : box.width) / page.width
    const x = box.x + (turn >= 180 ? box.width : 0)
    const y = box.y + (turn === 0 || turn === 270 ? box.height : 0)

    const ruled = from === null && page.pattern !== 'blank'
    const cards = cardsOn(out.canvas, page)
    const pictures: (Placed | null)[] = []
    for (const card of cards) pictures.push(await cardPdf(doc, card, out, palette, glyphs))
    if (ruled || cards.length) {
      sheet.pushOperators(
        lib.pushGraphicsState(),
        lib.translate(x, y),
        lib.rotateDegrees(turn),
        lib.scale(scale, scale),
        lib.rectangle(0, -page.height, page.width, page.height),
        lib.clip(),
        lib.endPath(),
      )
      if (ruled) {
        const place = placeOf(scale, turn, x, y)
        sheet.pushOperators(...rulingPdf(lib, doc, sheet, page, palette, place))
      }
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

      sheet.drawSvgPath(`${path} Z`, {
        x,
        y,
        rotate: degrees(turn),
        scale,
        color: rgb(colour.r, colour.g, colour.b),
        opacity: inkOpacity(stroke),
        borderWidth: 0,
        ...(INK_STYLES[stroke.tool].multiply ? { blendMode: BlendMode.Multiply } : {}),
      })
    }
  }

  for (let index = carried - 1; index >= 0; index -= 1) doc.removePage(index)

  return new Uint8Array(await doc.save())
}

type PdfLib = typeof import('pdf-lib')
type Sheet = import('pdf-lib').PDFPage
type Font = import('pdf-lib').PDFFont

type Six = [number, number, number, number, number, number]

function placeOf(scale: number, turn: number, x: number, y: number): Six {
  const cos = Math.round(Math.cos((turn * Math.PI) / 180))
  const sin = Math.round(Math.sin((turn * Math.PI) / 180))
  return [scale * cos, scale * sin, -scale * sin, scale * cos, x, y]
}

function cellOf(page: PageNode): { width: number; height: number; body: string } | null {
  const bar = (left: number, top: number, w: number, h: number) =>
    `${left} ${-(top + h)} ${w} ${h} re`
  switch (page.pattern) {
    case 'lines':
      return { width: page.width, height: LINES, body: bar(0, LINES - 1, page.width, 1) }
    case 'grid':
      return {
        width: GRID,
        height: GRID,
        body: `${bar(0, GRID - 1, GRID, 1)} ${bar(GRID - 1, 0, 1, GRID)}`,
      }
    case 'dots':
      return { width: GRID, height: GRID, body: bar(GRID / 2 - 0.75, GRID / 2 - 0.75, 1.5, 1.5) }
    case 'blank':
      return null
  }
}

function rulingPdf(
  lib: PdfLib,
  doc: import('pdf-lib').PDFDocument,
  sheet: Sheet,
  page: PageNode,
  palette: Palette,
  place: Six,
): import('pdf-lib').PDFOperator[] {
  const cell = cellOf(page)
  if (!cell) return []

  const colour = hexOf(palette.dot ?? '')
  const tile = doc.context.register(
    doc.context.stream(`${colour.r} ${colour.g} ${colour.b} rg ${cell.body} f`, {
      Type: 'Pattern',
      PatternType: 1,
      PaintType: 1,
      TilingType: 1,
      BBox: [0, -cell.height, cell.width, 0],
      XStep: cell.width,
      YStep: cell.height,
      Matrix: place,
      Resources: {},
    }),
  )
  const { Resources } = sheet.node.normalizedEntries()
  const named = lib.PDFName.of('Pattern')
  const patterns = Resources.lookupMaybe(named, lib.PDFDict) ?? doc.context.obj({})
  Resources.set(named, patterns)
  const key = patterns.uniqueKey('Ruling')
  patterns.set(key, tile)

  return [
    lib.PDFOperator.of(lib.PDFOperatorNames.NonStrokingColorspace, [named]),
    lib.PDFOperator.of(lib.PDFOperatorNames.NonStrokingColorN, [key]),
    lib.rectangle(0, -page.height, page.width, page.height),
    lib.fill(),
  ]
}

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

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function frameOf(
  card: CanvasNode & { type: 'text' },
  palette: Palette,
): { edge: string; wash: string | null } | null {
  if (card.bare) return null
  if (card.color === undefined) return { edge: palette.line ?? '', wash: null }
  const colour = inkColour(card.color, palette)
  return { edge: colour, wash: colour }
}

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

const PRINT_SCALE = 2

export async function printPages(out: PagesOut): Promise<void> {
  const bytes = await pagesPdf(out)
  if (!bytes) return

  const [{ loading, pdfjs }, { printInFrame, printsInFrame }] = await Promise.all([
    import('../pdf/document'),
    import('../export'),
  ])
  const linked = printsInFrame()
  const library = await pdfjs()
  const task = loading(library, bytes)
  const doc = await task.promise
  const texts: string[] = []
  const pieces: Blob[] = []
  const links: string[] = []
  const sizes: Size[] = []

  try {
    try {
      for (let number = 1; number <= doc.numPages; number += 1) {
        const page = await doc.getPage(number)
        const natural = page.getViewport({ scale: PDF_TO_CSS })
        const sharp = sharpness(natural.width, natural.height, PRINT_SCALE)
        const viewport = page.getViewport({ scale: PDF_TO_CSS * sharp })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(viewport.width))
        canvas.height = Math.max(1, Math.round(viewport.height))
        const context = canvas.getContext('2d')
        if (context) {
          await page.render({ canvas, canvasContext: context, viewport }).promise
          const size = { width: Math.round(natural.width), height: Math.round(natural.height) }
          const open = `<div class="sheet ${sizeName(sizes, size)}"><img src="`
          const close = `" alt="Page ${texts.length + pieces.length + 1}" width="${size.width}" height="${size.height}"></div>`
          if (linked) {
            const link = await linkOf(canvas)
            links.push(link)
            texts.push(`${open}${link}${close}`)
          } else {
            pieces.push(new Blob([open, (await pngData(canvas)) ?? 'data:,', close]))
          }
          canvas.width = 0
          canvas.height = 0
        }
        page.cleanup()
      }
    } finally {
      await task.destroy().catch(() => undefined)
    }

    const first = sizes[0]
    if (!first) return

    const head = [
      '<!doctype html><html><head><meta charset="utf-8">',
      `<title>${escaped(stem(out.name))}</title><style>`,
      sheetStyle(sizes),
      '</style></head><body>',
    ].join('')
    const tail = '</body></html>'
    const html = linked
      ? [head, ...texts, tail].join('')
      : new Blob([head, ...pieces, tail], { type: 'text/html' })
    pieces.length = 0

    await printInFrame(html, {
      width: first.width / 96,
      height: first.height / 96,
      margin: 0,
      landscape: false,
    })
  } finally {
    for (const link of links) URL.revokeObjectURL(link)
  }
}

interface Size {
  width: number
  height: number
}

function sizeName(sizes: Size[], size: Size): string {
  let at = sizes.findIndex((one) => one.width === size.width && one.height === size.height)
  if (at < 0) at = sizes.push(size) - 1
  return `s${String(at)}`
}

export function sheetStyle(sizes: readonly Size[]): string {
  const first = sizes[0]
  return [
    first ? `@page{size:${first.width}px ${first.height}px;margin:0}` : '',
    'html,body{margin:0;padding:0;background:#fff}',
    '.sheet{display:flex;align-items:center;justify-content:center;break-after:page;overflow:hidden}',
    '.sheet:last-child{break-after:auto}',
    'img{display:block;max-width:100%;max-height:100%}',
    ...sizes.map(
      (size, at) =>
        `@page s${String(at)}{size:${size.width}px ${size.height}px;margin:0}.s${String(at)}{page:s${String(at)};width:${size.width}px;height:${size.height}px}`,
    ),
  ].join('')
}

async function linkOf(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (!blob) throw new Error('a page could not be turned into a picture')

  return URL.createObjectURL(blob)
}

function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function hexOf(colour: string): { r: number; g: number; b: number } {
  const said = cssColour(colour.trim())
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(said)
  if (rgb) {
    const [r, g, b] = rgb.slice(1, 4).map((one) => Math.min(255, Number(one)) / 255)
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0 }
  }

  const found = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(said)
  if (!found?.[1]) return { r: 0, g: 0, b: 0 }

  const six = found[1].length === 3 ? found[1].replace(/./g, '$&$&') : found[1]
  const value = Number.parseInt(six, 16)
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  }
}

async function paperBytes(places: readonly string[]): Promise<Uint8Array | null> {
  for (const path of places) {
    const bytes = await fileBytes(path).catch(() => null)
    if (bytes) return bytes
  }
  return null
}
