import {
  type Canvas,
  emptyCanvas,
  endless,
  freshId,
  type InkStroke,
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
  const shifts = new Map<PageNode, { x: number; y: number }>()
  for (const was of before) {
    const is = byId.get(was.id)
    const shift = is && { x: is.x - was.x, y: is.y - was.y }
    if (shift && (shift.x || shift.y)) shifts.set(was, shift)
  }
  const by = <T extends { x: number; y: number }>(thing: T, shift?: { x: number; y: number }) =>
    shift ? { ...thing, x: thing.x + shift.x, y: thing.y + shift.y } : thing
  const column = columnOf(before)
  const shiftOf = (owner: PageNode | null) => (owner ? shifts.get(owner) : undefined)

  const nodes = canvas.nodes.map((node) => {
    const page = byId.get(node.id)
    if (page) return page
    return shifts.size ? by(node, shiftOf(ownerOf(node, column))) : node
  })
  const ink = canvas.ink.map((stroke) => {
    const shift = shifts.size ? shiftOf(inkOwnerOf(stroke, column)) : undefined
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

  const column = columnOf(pages)
  const nodes = canvas.nodes.filter(
    (node) => node.id !== id && (isPage(node) || ownerOf(node, column) !== page),
  )
  const ink = canvas.ink.filter((stroke) => inkOwnerOf(stroke, column) !== page)

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

interface Column<T extends Box> {
  pages: readonly T[]
  stacked: boolean
}

function columnOf<T extends Box>(pages: readonly T[]): Column<T> {
  let bottom = -Infinity
  let stacked = true
  for (const page of pages) {
    if (!(page.y >= bottom && page.height >= 0)) stacked = false
    bottom = page.y + page.height
  }
  return { pages, stacked }
}

function holds(page: Box, x: number, y: number): boolean {
  return x >= page.x && x < page.x + page.width && y >= page.y && y < page.y + page.height
}

function firstEndingBelow(pages: readonly Box[], y: number): number {
  let low = 0
  let high = pages.length
  while (low < high) {
    const middle = (low + high) >> 1
    const page = pages[middle]
    if (page && page.y + page.height > y) high = middle
    else low = middle + 1
  }
  return low
}

function holding<T extends Box>(column: Column<T>, x: number, y: number): T | undefined {
  const { pages } = column
  if (!column.stacked) return pages.find((page) => holds(page, x, y))
  const page = pages[firstEndingBelow(pages, y)]
  return page && holds(page, x, y) ? page : undefined
}

function ownerOf<T extends Box>(thing: Box, column: Column<T>): T | null {
  const held = holding(column, thing.x + thing.width / 2, thing.y + thing.height / 2)
  if (held) return held

  const { pages } = column
  let best: T | null = null
  let most = 0
  for (let at = column.stacked ? firstEndingBelow(pages, thing.y) : 0; at < pages.length; at++) {
    const page = pages[at]
    if (!page) continue
    if (column.stacked && page.y >= thing.y + thing.height) break
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

export function lowestOf(canvas: Canvas, boxOf: (stroke: InkStroke) => Box): Map<string, number> {
  const lowest = new Map<string, number>()
  const pages = pagesOf(canvas)
  if (!pages.some((page) => page.paper === 'long')) return lowest

  for (const page of pages) if (page.paper === 'long') lowest.set(page.id, page.y)
  const column = columnOf(pages)
  const lift = (page: PageNode, bottom: number) => {
    const held = lowest.get(page.id)
    if (held !== undefined) lowest.set(page.id, Math.max(held, bottom))
  }

  for (const node of canvas.nodes) {
    for (const page of across(column, node.y, node.y + node.height)) {
      if (page.id === node.id || page.paper !== 'long') continue
      if (node.x + node.width <= page.x || node.x >= page.x + page.width) continue
      if (node.y + node.height <= page.y || node.y >= page.y + page.height) continue
      lift(page, node.y + node.height)
    }
  }

  for (const stroke of canvas.ink) {
    const first = stroke.points[0]
    if (!first) continue
    const held = column.stacked ? [holding(column, first.x, first.y)] : pages
    for (const page of held) {
      if (page?.paper !== 'long' || !onPage(stroke, page)) continue
      const box = boxOf(stroke)
      lift(page, box.y + box.height)
    }
  }

  return lowest
}

function across<T extends Box>(column: Column<T>, top: number, bottom: number): readonly T[] {
  const { pages } = column
  if (!column.stacked) return pages
  const from = firstEndingBelow(pages, top)
  let to = from
  while (to < pages.length && (pages[to]?.y ?? Infinity) < bottom) to++
  return pages.slice(from, to)
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
  column: Column<T>,
): T | null {
  const first = stroke.points[0]
  if (!first) return null
  const held = holding(column, first.x, first.y)
  if (held) return held

  const xs = stroke.points.map((one) => one.x)
  const ys = stroke.points.map((one) => one.y)
  const x = xs.reduce((low, one) => Math.min(low, one))
  const y = ys.reduce((low, one) => Math.min(low, one))
  const width = xs.reduce((high, one) => Math.max(high, one)) - x
  const height = ys.reduce((high, one) => Math.max(high, one)) - y
  return ownerOf({ x, y, width, height }, column)
}

export function paperOf(pages: string): string {
  return `${pages}.pdf`
}

export function holderOf(path: string): string | null {
  return /\.pages\.pdf$/i.test(path) ? path.slice(0, -'.pdf'.length) : null
}

export function pairOf(path: string): string | null {
  return holderOf(path) ?? (/\.pages$/i.test(path) ? paperOf(path) : null)
}
