import {
  type Canvas,
  emptyCanvas,
  endless,
  freshId,
  isPage,
  type PageNode,
  PAPERS,
  type Paper,
  paperSized,
  type Pattern,
  writeCanvas,
} from './canvas'

export const GUTTER = 40

export const GROWTH = 600
const HEADROOM = 240

export function pagesOf(canvas: Canvas): PageNode[] {
  return canvas.nodes.filter(isPage)
}

export function pageCount(canvas: Canvas): number {
  return canvas.nodes.reduce((count, node) => (isPage(node) ? count + 1 : count), 0)
}

export function laidOut(pages: readonly PageNode[]): PageNode[] {
  let y = 0
  const out: PageNode[] = []

  for (const page of pages) {
    const x = -Math.round(page.width / 2)
    out.push(page.x === x && page.y === y ? page : { ...page, x, y })
    y += page.height + GUTTER
  }

  return out
}

export function settled(canvas: Canvas, before: readonly PageNode[] = pagesOf(canvas)): Canvas {
  const pages = pagesOf(canvas)
  if (!pages.length) return canvas

  const placed = laidOut(pages)
  if (placed.every((page, at) => page === pages[at])) return canvas

  const byId = new Map(placed.map((page) => [page.id, page]))
  const shifts = before.flatMap((was) => {
    const is = byId.get(was.id)
    const shift = is && { box: was, x: is.x - was.x, y: is.y - was.y }
    return shift && (shift.x || shift.y) ? [shift] : []
  })
  const by = <T extends { x: number; y: number }>(thing: T, shift?: { x: number; y: number }) =>
    shift ? { ...thing, x: thing.x + shift.x, y: thing.y + shift.y } : thing

  const nodes = canvas.nodes.map((node) => {
    const page = byId.get(node.id)
    if (page) return page
    const owner = ownerOf(node, before)
    return by(node, owner ? shifts.find((one) => one.box === owner) : undefined)
  })
  const ink = canvas.ink.map((stroke) => {
    const owner = inkOwnerOf(stroke, before)
    const shift = owner && shifts.find((one) => one.box === owner)
    return shift ? { ...stroke, points: stroke.points.map((one) => by(one, shift)) } : stroke
  })

  return { ...canvas, nodes, ink }
}

export function columnHeight(pages: readonly PageNode[]): number {
  return pages.reduce((tall, page) => tall + page.height + GUTTER, 0) - (pages.length ? GUTTER : 0)
}

export function newPage(paper: Paper = 'a4', pattern: Pattern = 'blank'): PageNode {
  const size = PAPERS[paper]

  return {
    id: freshId(),
    type: 'page',
    x: -Math.round(size.width / 2),
    y: 0,
    width: size.width,
    height: size.height,
    paper,
    pattern,
  }
}

export function pdfPage(file: string, page: number, width: number, height: number): PageNode {
  const wide = Math.max(1, Math.round(width))
  const tall = Math.max(1, Math.round(height))

  return {
    id: freshId(),
    type: 'page',
    x: -Math.round(wide / 2),
    y: 0,
    width: wide,
    height: tall,
    paper: paperSized(wide, tall),
    pattern: 'blank',
    file,
    page,
  }
}

export function added(canvas: Canvas, after: string | null = null): { canvas: Canvas; id: string } {
  const pages = pagesOf(canvas)
  const from = after === null ? pages[pages.length - 1] : pages.find((one) => one.id === after)
  const page = newPage(from?.paper ?? 'a4', from?.pattern ?? 'blank')

  const at = after === null ? -1 : canvas.nodes.findIndex((node) => node.id === after)
  const nodes = [...canvas.nodes]
  if (at < 0) nodes.push(page)
  else nodes.splice(at + 1, 0, page)

  return { canvas: settled({ ...canvas, nodes }, pages), id: page.id }
}

export function removed(canvas: Canvas, id: string): Canvas {
  const pages = pagesOf(canvas)
  const page = pages.find((one) => one.id === id)
  if (!page || pages.length < 2) return canvas

  const nodes = canvas.nodes.filter(
    (node) => node.id !== id && (isPage(node) || ownerOf(node, pages) !== page),
  )
  const ink = canvas.ink.filter((stroke) => inkOwnerOf(stroke, pages) !== page)

  return settled({ ...canvas, nodes, ink }, pages)
}

export function onPage(
  stroke: { points: readonly { x: number; y: number }[] },
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const first = stroke.points[0]
  if (!first) return false

  return (
    first.x >= box.x &&
    first.x < box.x + box.width &&
    first.y >= box.y &&
    first.y < box.y + box.height
  )
}

export function moved(canvas: Canvas, id: string, to: number): Canvas {
  const pages = pagesOf(canvas)
  const from = pages.findIndex((one) => one.id === id)
  if (from < 0) return canvas

  const target = Math.min(Math.max(0, Math.round(to)), pages.length - 1)
  if (target === from) return canvas

  const page = pages[from]
  if (!page) return canvas

  const order = pages.filter((one) => one.id !== id)
  order.splice(target, 0, page)

  let next = 0
  const nodes = canvas.nodes.map((node) => (isPage(node) ? (order[next++] ?? node) : node))

  return settled({ ...canvas, nodes }, pages)
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function overlap(thing: Box, box: Box): number {
  const across = Math.min(thing.x + thing.width, box.x + box.width) - Math.max(thing.x, box.x)
  const down = Math.min(thing.y + thing.height, box.y + box.height) - Math.max(thing.y, box.y)
  return across > 0 && down > 0 ? across * down : 0
}

function ownerOf<T extends Box>(thing: Box, pages: readonly T[]): T | null {
  const x = thing.x + thing.width / 2
  const y = thing.y + thing.height / 2
  const holding = pages.find(
    (page) => x >= page.x && x < page.x + page.width && y >= page.y && y < page.y + page.height,
  )
  if (holding) return holding

  let best: T | null = null
  let most = 0
  for (const page of pages) {
    const area = overlap(thing, page)
    if (area > most) {
      most = area
      best = page
    }
  }
  return best
}

export function reshaped(
  canvas: Canvas,
  id: string,
  change: { paper?: Paper; pattern?: Pattern },
): Canvas {
  const nodes = canvas.nodes.map((node) => {
    if (node.id !== id || !isPage(node)) return node

    const paper = change.paper ?? node.paper
    const pattern = change.pattern ?? node.pattern
    if (paper === node.paper && pattern === node.pattern) return node

    const size = PAPERS[paper]
    const height = endless(paper) ? Math.max(size.height, node.height) : size.height

    return { ...node, paper, pattern, width: size.width, height }
  })

  return settled({ ...canvas, nodes }, pagesOf(canvas))
}

export function grown(canvas: Canvas, lowest: ReadonlyMap<string, number>): Canvas {
  const nodes = canvas.nodes.map((node) => {
    if (!isPage(node) || !endless(node.paper)) return node

    const reach = lowest.get(node.id)
    if (reach === undefined) return node

    const wanted = reach + HEADROOM - node.y
    if (wanted <= node.height) return node

    const steps = Math.ceil((wanted - node.height) / GROWTH)
    return { ...node, height: node.height + steps * GROWTH }
  })

  if (nodes.every((node, at) => node === canvas.nodes[at])) return canvas

  return settled({ ...canvas, nodes }, pagesOf(canvas))
}

export function emptyPages(paper: Paper = 'a4'): Canvas {
  return { ...emptyCanvas(), nodes: [newPage(paper)] }
}

export function blankPages(paper: Paper = 'a4'): string {
  return writeCanvas(emptyPages(paper))
}

export function pagesFromPdf(
  file: string,
  sizes: readonly { width: number; height: number }[],
): Canvas {
  const pages = sizes.map((size, at) => pdfPage(file, at + 1, size.width, size.height))
  return settled({ ...emptyCanvas(), nodes: pages.length ? pages : [newPage()] })
}

export function pageAt(
  pages: readonly PageNode[],
  point: { x: number; y: number },
): PageNode | null {
  for (const page of pages) {
    if (
      point.x >= page.x &&
      point.x <= page.x + page.width &&
      point.y >= page.y &&
      point.y <= page.y + page.height
    ) {
      return page
    }
  }

  return null
}

export function pageShowing(pages: readonly PageNode[], top: number, height: number): number {
  if (!pages.length) return 0

  const middle = top + height / 2
  for (const [at, page] of pages.entries()) {
    if (middle < page.y + page.height + GUTTER / 2) return at + 1
  }

  return pages.length
}

function inkOwnerOf<T extends Box>(
  stroke: { points: readonly { x: number; y: number }[] },
  pages: readonly T[],
): T | null {
  const held = pages.find((page) => onPage(stroke, page))
  if (held || !stroke.points.length) return held ?? null

  const xs = stroke.points.map((one) => one.x)
  const ys = stroke.points.map((one) => one.y)
  const x = xs.reduce((low, one) => Math.min(low, one))
  const y = ys.reduce((low, one) => Math.min(low, one))
  const width = xs.reduce((high, one) => Math.max(high, one)) - x
  const height = ys.reduce((high, one) => Math.max(high, one)) - y
  return ownerOf({ x, y, width, height }, pages)
}
