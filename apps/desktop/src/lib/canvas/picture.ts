import { escapeAll } from '@orden/markdown/html'
import { decoded, pageBytes, assetPath, invoke, isDesktop } from '../platform/src/api'
import { exporters, writtenPdf } from '../export/src/api'
import { chooseTarget, download, handOver, writeFile } from '../files-out/src/api'
import { type Canvas, type CanvasNode } from './format'
import { planeBox } from './edits'
import {
  arrowAt,
  type Box,
  boxOf,
  edgeEnds,
  edgeMiddle,
  edgePath,
  isLineShape,
  shapeLine,
  shapePath,
} from './geometry'
import { inkSvg } from './svg'
import { paletteOf } from './palette'
import type { Palette } from './paint'
import { cardHtml, fileUrl, isPicture } from './render'
import { type Faces, faceOf, NO_FACES, pdfFaces } from './faces'
import { message } from '../ui-kit/src/api'
import { settings } from '../settings.svelte'

const PADDING = 32

function colourOf(node: { color?: string }, palette: Palette, fallback: string): string {
  const colour = node.color
  if (colour === undefined) return fallback
  return palette[colour] ?? colour
}

export function styles(palette: Palette): string {
  return `
    .card { box-sizing: border-box; width: 100%; height: 100%; padding: 8px 12px;
      overflow: hidden; color: ${palette.text ?? '#111'};
      font: 13px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    .card > :first-child { margin-top: 0 }
    .card > :last-child { margin-bottom: 0 }
    .card h1, .card h2, .card h3 { margin: 0 0 4px; font-size: 1.15em; line-height: 1.3 }
    .card p { margin: 0 0 6px }
    .card ul, .card ol { margin: 0 0 6px; padding-left: 1.2em }
    .card img { max-width: 100% }
    .card code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em }
    .card a { color: ${palette.accent ?? '#4c6ef5'}; text-decoration: none }
    .label { font: 550 13px/1 ui-sans-serif, system-ui, sans-serif }
    .words { font: 13px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif }
  `
}

function asXml(html: string): string {
  const page = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = page.body.firstElementChild
  if (!root) return ''

  return new XMLSerializer().serializeToString(root).replace(/^<div[^>]*>|<\/div>$/g, '')
}

function plainLines(text: string): string[] {
  return text.split('\n').map((line) =>
    line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}[-*+]\s+/, '• ')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/([*_~`])(.+?)\1/g, '$2')
      .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, shown?: string) =>
        (shown ?? target).trim(),
      )
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'),
  )
}

const PER_CHARACTER = 0.52
const LINE = 17
const CARD_FONT = 13

function fitted(text: string, width: number): string[] {
  const most = Math.max(4, Math.floor((width - 24) / (CARD_FONT * PER_CHARACTER)))
  const out: string[] = []

  for (const line of plainLines(text)) {
    let rest = line

    while (rest.length > most) {
      const space = rest.lastIndexOf(' ', most)
      const cut = space > most / 2 ? space : most
      out.push(rest.slice(0, cut))
      rest = rest.slice(space > most / 2 ? cut + 1 : cut)
    }

    out.push(rest)
  }

  return out
}

function plainCard(text: string, box: Box, palette: Palette): string {
  const lines = fitted(text, box.width).slice(0, Math.floor((box.height - 12) / LINE))
  if (!lines.length) return ''

  const spans = lines
    .map(
      (line, index) =>
        `<tspan x="${box.x + 12}" y="${box.y + 20 + index * LINE}">${escapeAll(line)}</tspan>`,
    )
    .join('')

  return `<text font-size="${CARD_FONT}" fill="${palette.text ?? '#111'}" class="words">${spans}</text>`
}

function cardBody(node: CanvasNode, canvasPath: string | null, trusted: boolean): string {
  switch (node.type) {
    case 'text':
      return `<div class="card" xmlns="http://www.w3.org/1999/xhtml">${asXml(cardHtml(node.text, canvasPath, trusted))}</div>`
    case 'link':
      return `<div class="card" xmlns="http://www.w3.org/1999/xhtml"><strong>${escapeAll(hostOf(node.url))}</strong><br/><span style="opacity:.6">${escapeAll(node.url)}</span></div>`
    case 'file':
      if (isPicture(node.file)) return ''
      return `<div class="card" xmlns="http://www.w3.org/1999/xhtml" style="opacity:.75">${escapeAll(node.file)}</div>`
    case 'group':
    case 'shape':
    case 'page':
      return ''
  }
}

function shapeWords(
  node: CanvasNode & { type: 'shape' },
  box: Box,
  palette: Palette,
  canvasPath: string | null,
  plain: boolean,
  trusted: boolean,
): string {
  if (!node.text) return ''

  if (plain) return plainCard(node.text, box, palette)

  return `<foreignObject x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"><div class="card" xmlns="http://www.w3.org/1999/xhtml" style="display:flex;flex-direction:column;justify-content:center;text-align:center">${asXml(cardHtml(node.text, canvasPath, trusted))}</div></foreignObject>`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function drawnNode(
  node: CanvasNode,
  palette: Palette,
  canvasPath: string | null,
  root: string | null,
  plain: boolean,
  trusted: boolean,
  faces: Faces = NO_FACES,
): string {
  const box = boxOf(node)
  const line = colourOf(node, palette, palette.line ?? '#d6d9de')

  if (node.type === 'group') {
    const name = node.label
      ? `<text class="label" x="${box.x + 2}" y="${box.y - 6}" fill="${line}">${escapeAll(node.label)}</text>`
      : ''
    return `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" fill="${line}" fill-opacity="0.07" stroke="${line}" stroke-dasharray="6 5"/>${name}</g>`
  }

  if (node.type === 'shape') {
    const stroke = colourOf(node, palette, palette.text ?? '#111')
    const fill = node.fill ? stroke : 'none'
    const opacity = node.fill ? 0.18 : 1

    const words = shapeWords(node, box, palette, canvasPath, plain, trusted)

    if (node.shape === 'rect') {
      return `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>${words}</g>`
    }
    if (node.shape === 'ellipse') {
      return `<g><ellipse cx="${box.x + box.width / 2}" cy="${box.y + box.height / 2}" rx="${box.width / 2}" ry="${box.height / 2}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>${words}</g>`
    }

    const corners = shapePath(node)
    const open = isLineShape(node.shape)
    const d = `M ${corners.map((one) => `${one.x} ${one.y}`).join(' L ')}${open ? '' : ' Z'}`

    const ends = shapeLine(node)
    const head =
      node.shape === 'arrow'
        ? `<path d="M 0 0 L -11 -5.5 L -11 5.5 Z" fill="${stroke}" transform="translate(${ends.to.x} ${ends.to.y}) rotate(${(Math.atan2(ends.to.y - ends.from.y, ends.to.x - ends.from.x) * 180) / Math.PI})"/>`
        : ''

    const body = `<path d="${d}" fill="${open ? 'none' : fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    return `<g>${body}${head}${shapeWords(node, box, palette, canvasPath, plain, trusted)}</g>`
  }

  if (node.type === 'file' && isPicture(node.file)) {
    return `<image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid slice" href="${escapeAll(fileUrl(node.file, root))}"/>`
  }

  const face = node.type === 'file' ? faces.get(faceOf(node)) : undefined
  if (face) {
    return `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" fill="${palette.surface ?? '#fff'}" stroke="${line}"/><image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet" href="${escapeAll(face)}"/></g>`
  }

  const wash = node.color === undefined ? '' : ` fill-opacity="0.09"`
  const paper = node.color === undefined ? (palette.surface ?? '#fff') : line
  const card =
    node.type === 'text' && node.bare
      ? ''
      : `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" fill="${paper}"${wash} stroke="${line}"/>`

  if (plain) {
    return `<g>${card}${plainCard(saidBy(node), box, palette)}</g>`
  }

  return `<g>${card}<foreignObject x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}">${cardBody(node, canvasPath, trusted)}</foreignObject></g>`
}

function saidBy(node: CanvasNode): string {
  switch (node.type) {
    case 'text':
      return node.text
    case 'link':
      return `${hostOf(node.url)}\n${node.url}`
    case 'file':
      return node.file
    case 'group':
    case 'shape':
    case 'page':
      return ''
  }
}

function drawnEdges(canvas: Canvas, palette: Palette): string {
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))
  const out: string[] = []

  for (const edge of canvas.edges) {
    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
    if (!from || !to) continue

    const colour = colourOf(edge, palette, palette.muted ?? '#8a9099')
    const ends = edgeEnds(edge, boxOf(from), boxOf(to))
    const heads: string[] = []

    for (const head of [
      edge.fromEnd === 'arrow' ? arrowAt(ends.from, ends.fromSide) : null,
      edge.toEnd === 'none' ? null : arrowAt(ends.to, ends.toSide),
    ]) {
      if (head) {
        heads.push(
          `<path d="M 0 0 L -9 -4.5 L -9 4.5 Z" fill="${colour}" transform="translate(${head.x} ${head.y}) rotate(${head.angle})"/>`,
        )
      }
    }

    const middle = edge.label === undefined ? '' : edgeMiddle(ends)
    const label =
      typeof middle === 'string' || edge.label === undefined
        ? ''
        : `<text x="${middle.x}" y="${middle.y}" font-size="12" text-anchor="middle" dominant-baseline="middle" fill="${palette.text ?? '#111'}" paint-order="stroke" stroke="${palette.bg ?? '#fff'}" stroke-width="4" stroke-linejoin="round" class="label">${escapeAll(edge.label)}</text>`

    out.push(
      `<g><path d="${edgePath(ends)}" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round"/>${heads.join('')}${label}</g>`,
    )
  }

  return out.join('')
}

export function canvasSvg(
  canvas: Canvas,
  palette: Palette,
  canvasPath: string | null,
  root: string | null,
  plain = false,
  trusted = false,
  faces: Faces = NO_FACES,
): string {
  const box = planeBox(canvas) ?? {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  }

  const x = Math.round(box.x - PADDING)
  const y = Math.round(box.y - PADDING)
  const width = Math.max(1, Math.round(box.width + 2 * PADDING))
  const height = Math.max(1, Math.round(box.height + 2 * PADDING))

  const nodes = canvas.nodes
    .map((node) => drawnNode(node, palette, canvasPath, root, plain, trusted, faces))
    .join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}">`,
    `<style>${styles(palette)}</style>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${palette.bg ?? '#fff'}"/>`,
    drawnEdges(canvas, palette),
    nodes,
    inkSvg(canvas.ink, palette),
    `</svg>`,
  ].join('')
}

const PNG_SCALE = 2
const PNG_MOST = 8000

function sizeOf(svg: string): { width: number; height: number } {
  const size = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(svg)
  return { width: Number(size?.[3] ?? 800), height: Number(size?.[4] ?? 600) }
}

async function svgToPng(svg: string, whole: string | Blob): Promise<Blob | null> {
  const { width, height } = sizeOf(svg)
  const scale = Math.min(PNG_SCALE, PNG_MOST / Math.max(width, height, 1))

  const url = URL.createObjectURL(new Blob([whole], { type: 'image/svg+xml' }))

  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => reject(new Error('the drawing could not be read')), {
        once: true,
      })
      image.src = url
    })

    const paper = document.createElement('canvas')
    paper.width = Math.max(1, Math.round(width * scale))
    paper.height = Math.max(1, Math.round(height * scale))

    const ctx = paper.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(image, 0, 0, paper.width, paper.height)
    return await new Promise((resolve) => paper.toBlob(resolve, 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'Canvas'
}

export interface Drawing {
  canvas: Canvas
  palette: Palette
  path: string | null
  root: string | null
  name: string
  trusted: boolean
}

async function readySvg(
  drawing: Drawing,
  palette: Palette,
  plain = false,
): Promise<{ svg: string; whole: string | Blob }> {
  const svg = canvasSvg(
    drawing.canvas,
    palette,
    drawing.path,
    drawing.root,
    plain,
    drawing.trusted,
    await facesOf(drawing),
  )
  const { wholeSheet } = await exporters()
  return { svg, whole: await wholeSheet(svg, fromAsset) }
}

function facesOf(drawing: Drawing): Promise<Faces> {
  return pdfFaces(drawing.canvas.nodes, { note: drawing.path, root: drawing.root })
}

function chosenPalette(drawing: Drawing): Palette {
  const chosen = settings.exportAppearance
  return chosen === 'app' ? drawing.palette : paletteOf(chosen)
}

const DRAWN = /(<image\b[^>]*?\bhref=")([^"]*)(")/g

const fromAsset = (src: string) => assetPath(src) ?? src

export async function inlinedSvg(svg: string): Promise<string> {
  try {
    const { assetsOf, inlineImages, localSources } = await exporters()
    const drawn = [...svg.matchAll(DRAWN)].map((match) => `<img src="${match[2] ?? ''}">`)
    const found = await assetsOf(localSources(drawn.join('')), fromAsset)
    return await inlineImages(
      svg.replace(
        DRAWN,
        (_whole: string, before: string, src: string, after: string) =>
          `${before}${found.get(src) ?? src}${after}`,
      ),
      fromAsset,
    )
  } catch {
    return svg
  }
}

export async function exportCanvasSvg(drawing: Drawing) {
  const { whole } = await readySvg(drawing, chosenPalette(drawing))
  const file = `${stem(drawing.name)}.svg`

  if (!isDesktop) {
    download(file, { pieces: new Blob([whole], { type: 'image/svg+xml' }) })
    return file
  }

  const target = await chooseTarget(drawing.name, 'svg', 'SVG')
  if (!target) return

  await writeFile(target, await pageBytes(whole))
  return target
}

export async function exportCanvasPng(drawing: Drawing) {
  const { svg, whole } = await readySvg(drawing, chosenPalette(drawing), true)
  const blob = await svgToPng(svg, whole).catch(() => null)
  if (!blob) {
    message(new Error('that drawing could not be turned into a picture'), 'Nothing here')
    return
  }

  const name = `${stem(drawing.name)}.png`
  handOver(name, blob)
  return name
}

function sheetOf(drawing: Drawing, faces: Faces, policy: string) {
  const svg = canvasSvg(
    drawing.canvas,
    paletteOf('light'),
    drawing.path,
    drawing.root,
    false,
    drawing.trusted,
    faces,
  )
  const { width, height } = sizeOf(svg)

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${escapeAll(stem(drawing.name))}</title><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg}</body></html>`

  return { html, page: { width: width / 96, height: height / 96, margin: 0, landscape: false } }
}

async function printSheet(drawing: Drawing, faces: Faces) {
  const { printsInFrame, printWithPictures, SHEET_POLICY } = await exporters()
  if (!printsInFrame()) {
    const { html, page } = sheetOf(drawing, faces, SHEET_POLICY)
    await printWithPictures(html, fromAsset, page)
    return
  }

  const links = new Map<string, string>()
  try {
    for (const [key, face] of faces) {
      const bytes = await decoded(face)
      links.set(key, URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' })))
    }
    const { html, page } = sheetOf(drawing, links, SHEET_POLICY)
    await printWithPictures(html, fromAsset, page)
  } finally {
    for (const link of links.values()) URL.revokeObjectURL(link)
  }
}

export async function printCanvas(drawing: Drawing) {
  await printSheet(drawing, await facesOf(drawing))
}

export async function exportCanvasPdf(drawing: Drawing) {
  const native = isDesktop && (await invoke<boolean>('pdf_supported').catch(() => false))
  const target = native ? await chooseTarget(drawing.name, 'pdf', 'PDF') : null

  const faces = await facesOf(drawing)

  if (target) {
    const { SHEET_POLICY, wholeSheet } = await exporters()
    const { html, page } = sheetOf(drawing, faces, SHEET_POLICY)
    if (await writtenPdf(await wholeSheet(html, fromAsset), target, page)) return target
  }

  await printSheet(drawing, faces)
}
