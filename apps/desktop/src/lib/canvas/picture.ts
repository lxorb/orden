/** A canvas as a picture: one SVG, and the two other formats made out of it.
 *
 *  SVG is the only drawing here. A PNG is that SVG rasterised by the browser,
 *  and a PDF is that SVG on a page handed to the same printer the notes use, so
 *  there is one description of what a canvas looks like on paper rather than
 *  three that drift apart.
 *
 *  Cards keep their words. The rendered markdown goes inside a `foreignObject`,
 *  which every browser draws and every browser can rasterise, so an exported
 *  canvas has headings and lists in it rather than grey boxes. Pictures are
 *  inlined as data, so the file stands on its own once it has left the app. */

import { inlineImages, chooseTarget, download, printInFrame } from '../export'
import { type Canvas, type CanvasNode } from './format'
import { arrowAt, bounds, boxOf, edgeEnds, edgeMiddle, edgePath, shapeLine } from './geometry'
import { outlineOf, strokeBox } from './ink'
import { INK_STYLES } from './ink'
import type { Palette } from './paint'
import { cardHtml, fileUrl, isPicture } from './render'
import { invoke, isDesktop } from '../tauri'

/** Room left round the drawing, in plane units. */
const PADDING = 32

function escaped(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function colourOf(node: { color?: string }, palette: Palette, fallback: string): string {
  const colour = node.color
  if (colour === undefined) return fallback
  return palette[colour] ?? colour
}

/** How the words inside a card are set, since an SVG carries no stylesheet of
 *  its own and a `foreignObject` inherits nothing from the page it came from. */
function styles(palette: Palette): string {
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
  `
}

function cardBody(node: CanvasNode, canvasPath: string | null): string {
  switch (node.type) {
    case 'text':
      return `<div class="card" xmlns="http://www.w3.org/1999/xhtml">${cardHtml(node.text, canvasPath)}</div>`
    case 'link':
      return `<div class="card" xmlns="http://www.w3.org/1999/xhtml"><strong>${escaped(hostOf(node.url))}</strong><br/><span style="opacity:.6">${escaped(node.url)}</span></div>`
    case 'file':
      if (isPicture(node.file)) return ''
      return `<div class="card" xmlns="http://www.w3.org/1999/xhtml" style="opacity:.75">${escaped(node.file)}</div>`
    case 'group':
    case 'shape':
      // Drawn as themselves rather than as a card with words in it.
      return ''
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    // Not a URL a browser would parse, so the whole of it is the name.
    return url
  }
}

/** One node as SVG. A group is a dashed frame with its name above it, a shape is
 *  itself, a picture is the picture, and everything else is a card. */
function drawnNode(
  node: CanvasNode,
  palette: Palette,
  canvasPath: string | null,
  root: string | null,
): string {
  const box = boxOf(node)
  const line = colourOf(node, palette, palette.line ?? '#d6d9de')

  if (node.type === 'group') {
    const name = node.label
      ? `<text class="label" x="${box.x + 2}" y="${box.y - 6}" fill="${line}">${escaped(node.label)}</text>`
      : ''
    return `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" fill="${line}" fill-opacity="0.07" stroke="${line}" stroke-dasharray="6 5"/>${name}</g>`
  }

  if (node.type === 'shape') {
    const stroke = colourOf(node, palette, palette.text ?? '#111')
    const fill = node.fill ? stroke : 'none'
    const opacity = node.fill ? 0.18 : 1

    if (node.shape === 'rect') {
      return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>`
    }
    if (node.shape === 'ellipse') {
      return `<ellipse cx="${box.x + box.width / 2}" cy="${box.y + box.height / 2}" rx="${box.width / 2}" ry="${box.height / 2}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>`
    }

    const ends = shapeLine(node)
    const head =
      node.shape === 'arrow'
        ? `<path d="M 0 0 L -11 -5.5 L -11 5.5 Z" fill="${stroke}" transform="translate(${ends.to.x} ${ends.to.y}) rotate(${(Math.atan2(ends.to.y - ends.from.y, ends.to.x - ends.from.x) * 180) / Math.PI})"/>`
        : ''
    return `<g><line x1="${ends.from.x}" y1="${ends.from.y}" x2="${ends.to.x}" y2="${ends.to.y}" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>${head}</g>`
  }

  if (node.type === 'file' && isPicture(node.file)) {
    return `<image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid slice" href="${escaped(fileUrl(node.file, root))}"/>`
  }

  const wash = node.color === undefined ? '' : ` fill-opacity="0.09"`
  const paper = node.color === undefined ? (palette.surface ?? '#fff') : line

  return `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" fill="${paper}"${wash} stroke="${line}"/><foreignObject x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}">${cardBody(node, canvasPath)}</foreignObject></g>`
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
        : `<text x="${middle.x}" y="${middle.y}" font-size="12" text-anchor="middle" dominant-baseline="middle" fill="${palette.text ?? '#111'}" paint-order="stroke" stroke="${palette.bg ?? '#fff'}" stroke-width="4" stroke-linejoin="round" class="label">${escaped(edge.label)}</text>`

    out.push(
      `<g><path d="${edgePath(ends)}" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round"/>${heads.join('')}${label}</g>`,
    )
  }

  return out.join('')
}

function drawnInk(canvas: Canvas, palette: Palette): string {
  const out: string[] = []

  for (const stroke of canvas.ink) {
    const style = INK_STYLES[stroke.tool]
    const ring = outlineOf(stroke)
    if (ring.length < 3) continue

    const d = `M ${ring.map((point) => `${round(point.x)} ${round(point.y)}`).join(' L ')} Z`
    const colour = palette[stroke.color] ?? stroke.color
    const blend = style.multiply ? ' style="mix-blend-mode:multiply"' : ''

    out.push(`<path d="${d}" fill="${colour}" fill-opacity="${style.opacity}"${blend}/>`)
  }

  return out.join('')
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** The whole plane as one SVG, sized to what is on it. */
function canvasSvg(
  canvas: Canvas,
  palette: Palette,
  canvasPath: string | null,
  root: string | null,
): string {
  const box = bounds(canvas.nodes, canvas.ink.map(strokeBox)) ?? {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  }

  const x = Math.round(box.x - PADDING)
  const y = Math.round(box.y - PADDING)
  const width = Math.max(1, Math.round(box.width + 2 * PADDING))
  const height = Math.max(1, Math.round(box.height + 2 * PADDING))

  const nodes = canvas.nodes.map((node) => drawnNode(node, palette, canvasPath, root)).join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}">`,
    `<style>${styles(palette)}</style>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${palette.bg ?? '#fff'}"/>`,
    drawnEdges(canvas, palette),
    nodes,
    drawnInk(canvas, palette),
    `</svg>`,
  ].join('')
}

/** How many device pixels a plane unit becomes in a PNG. Two, so the picture is
 *  crisp where it is going to be looked at, and no more, so a large plane is
 *  still an image somebody can send. */
const PNG_SCALE = 2
const PNG_MOST = 8000

/** The SVG rasterised by the browser itself. Nothing else can draw a
 *  `foreignObject`, and nothing else has the fonts. */
async function svgToPng(svg: string): Promise<Blob | null> {
  const size = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(svg)
  const width = Number(size?.[3] ?? 800)
  const height = Number(size?.[4] ?? 600)
  const scale = Math.min(PNG_SCALE, PNG_MOST / Math.max(width, height, 1))

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))

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

/** What a canvas is called once it has left the app. */
function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'Canvas'
}

export interface Drawing {
  canvas: Canvas
  palette: Palette
  path: string | null
  root: string | null
  name: string
}

/** The SVG, with every picture in it inlined so the file stands alone. */
async function readySvg(drawing: Drawing): Promise<string> {
  const svg = canvasSvg(drawing.canvas, drawing.palette, drawing.path, drawing.root)
  // `inlineImages` matches `<img src>`, which is what a card's markdown holds;
  // an `<image href>` is swapped the same way by asking for the same resolver.
  return inlineImages(svg.replace(/<image /g, '<img ').replace(/href="/g, 'src="'), (src) => src)
    .then((inlined) => inlined.replace(/<img /g, '<image ').replace(/src="/g, 'href="'))
    .catch(() => svg)
}

export async function exportCanvasSvg(drawing: Drawing) {
  const svg = await readySvg(drawing)
  const file = `${stem(drawing.name)}.svg`

  if (!isDesktop) {
    download(file, svg, 'image/svg+xml')
    return file
  }

  const target = await chooseTarget(drawing.name, 'svg', 'SVG')
  if (!target) return

  await invoke('write_note', { path: target, content: svg })
  return target
}

/** A PNG is handed over rather than written to a path of the reader's choosing:
 *  the app's own file commands write text, and a picture is bytes. The browser's
 *  own save is what every other binary download in the app uses too. */
export async function exportCanvasPng(drawing: Drawing) {
  const blob = await svgToPng(await readySvg(drawing))
  if (!blob) return

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${stem(drawing.name)}.png`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)

  return link.download
}

/** The plane on a page, through the same printer a note goes through. */
export async function exportCanvasPdf(drawing: Drawing) {
  const svg = await readySvg(drawing)
  const size = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(svg)
  const width = Number(size?.[3] ?? 800)
  const height = Number(size?.[4] ?? 600)

  // The paper is the drawing: a plane has no columns to break into pages, so it
  // goes on one sheet of its own size rather than being cut across A4.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escaped(stem(drawing.name))}</title><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg}</body></html>`

  const native = isDesktop && (await invoke<boolean>('pdf_supported').catch(() => false))
  const target = native ? await chooseTarget(drawing.name, 'pdf', 'PDF') : null

  if (target) {
    try {
      await invoke('print_pdf', {
        html,
        output: target,
        page: { width: width / 96, height: height / 96, margin: 0, landscape: false },
      })
      return target
    } catch {
      // The print dialog can still save the file, so nobody is left with nothing.
    }
  }

  await printInFrame(html)
}
