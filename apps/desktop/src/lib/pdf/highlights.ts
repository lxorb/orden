import { linkTo } from '../composer'
import { isRecord, isNumber, isString } from '../platform/src/api'

export const SIDECAR = '.highlights.json'

const VERSION = 1

export type Quad = readonly [number, number, number, number, number, number, number, number]

export const COLOURS = ['var(--accent)', 'var(--success)', 'var(--callout-warning)'] as const

export interface Highlight {
  id: string
  page: number
  text: string
  quads: Quad[]
  colour: number
  created: number
}

export type Held = 'newer' | 'unreadable' | 'damaged'

export interface Sheet {
  version: number
  highlights: Highlight[]
  held?: Held
}

export function emptySheet(): Sheet {
  return { version: VERSION, highlights: [] }
}

export function leftAlone(held: Held): Sheet {
  return { version: VERSION, highlights: [], held }
}

export function frozen(sheet: Sheet): Held | null {
  return sheet.held ?? (sheet.version > VERSION ? 'newer' : null)
}

function readQuad(value: unknown): Quad | null {
  if (!Array.isArray(value) || value.length !== 8) return null

  const at = (index: number): number => {
    const one: unknown = value[index]
    return isNumber(one) ? one : Number.NaN
  }

  const quad: Quad = [at(0), at(1), at(2), at(3), at(4), at(5), at(6), at(7)]
  return quad.some(Number.isNaN) ? null : quad
}

function readHighlight(value: unknown): Highlight | null {
  if (!isRecord(value)) return null

  const quads = Array.isArray(value.quads)
    ? value.quads.map(readQuad).filter((quad): quad is Quad => quad !== null)
    : []
  const page = isNumber(value.page) ? Math.floor(value.page) : 0
  if (page < 1 || !quads.length) return null

  return {
    id: isString(value.id) && value.id ? value.id : `${page}-${quads[0]?.[0] ?? 0}`,
    page,
    text: isString(value.text) ? value.text : '',
    quads,
    colour: isNumber(value.colour) ? Math.min(Math.max(0, Math.floor(value.colour)), 2) : 0,
    created: isNumber(value.created) ? value.created : 0,
  }
}

export function readSheet(text: string): Sheet {
  if (!text.trim()) return emptySheet()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return leftAlone('damaged')
  }

  if (!isRecord(parsed)) return emptySheet()

  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights.map(readHighlight).filter((one): one is Highlight => one !== null)
    : []

  return {
    version: isNumber(parsed.version) ? parsed.version : VERSION,
    highlights: sorted(highlights),
  }
}

function sorted(highlights: readonly Highlight[]): Highlight[] {
  return [...highlights].sort(
    (one, other) =>
      one.page - other.page || one.created - other.created || (one.id < other.id ? -1 : 1),
  )
}

export function writeSheet(sheet: Sheet): string {
  if (!sheet.highlights.length) return ''

  return `${JSON.stringify({ version: VERSION, highlights: sorted(sheet.highlights) }, null, 2)}\n`
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export type Point = (x: number, y: number) => readonly [number, number]

export type Transform = readonly [number, number, number, number, number, number]

export function matrixOf(values: readonly number[]): Transform {
  return [
    values[0] ?? 1,
    values[1] ?? 0,
    values[2] ?? 0,
    values[3] ?? 1,
    values[4] ?? 0,
    values[5] ?? 0,
  ]
}

export function toViewport(matrix: Transform): Point {
  const [a, b, c, d, e, f] = matrix
  return (x, y) => [a * x + c * y + e, b * x + d * y + f]
}

export function toPdf(matrix: Transform): Point {
  const [a, b, c, d, e, f] = matrix
  const determinant = a * d - b * c
  if (!determinant) return () => [0, 0]

  return (x, y) => [
    (d * (x - e) - c * (y - f)) / determinant,
    (a * (y - f) - b * (x - e)) / determinant,
  ]
}

export function boxOf(quad: Quad, toViewport: Point): Box {
  const xs: number[] = []
  const ys: number[] = []

  for (let corner = 0; corner < 8; corner += 2) {
    const [x, y] = toViewport(quad[corner] ?? 0, quad[corner + 1] ?? 0)
    xs.push(x)
    ys.push(y)
  }

  const left = xs.reduce((low, one) => Math.min(low, one), Infinity)
  const top = ys.reduce((low, one) => Math.min(low, one), Infinity)

  return {
    left,
    top,
    width: xs.reduce((high, one) => Math.max(high, one), -Infinity) - left,
    height: ys.reduce((high, one) => Math.max(high, one), -Infinity) - top,
  }
}

export function quadOf(box: Box, toPdf: Point): Quad {
  const right = box.left + box.width
  const bottom = box.top + box.height

  const [x1, y1] = toPdf(box.left, box.top)
  const [x2, y2] = toPdf(right, box.top)
  const [x3, y3] = toPdf(right, bottom)
  const [x4, y4] = toPdf(box.left, bottom)

  return [x1, y1, x2, y2, x3, y3, x4, y4]
}

const SAME_LINE = 1.5

export function joinRuns(boxes: readonly Box[]): Box[] {
  const out: Box[] = []

  for (const box of [...boxes].sort((one, other) => one.top - other.top || one.left - other.left)) {
    if (box.width <= 0 || box.height <= 0) continue

    const last = out[out.length - 1]
    const sameLine =
      last !== undefined &&
      Math.abs(last.top - box.top) < SAME_LINE &&
      Math.abs(last.height - box.height) < SAME_LINE &&
      box.left <= last.left + last.width + SAME_LINE

    if (last && sameLine) {
      const right = Math.max(last.left + last.width, box.left + box.width)
      last.left = Math.min(last.left, box.left)
      last.width = right - last.left
      continue
    }

    out.push({ ...box })
  }

  return out
}

export function citation(name: string, page: number, text: string): string {
  const link = linkTo(name, null, { fragment: `page=${page}` })
  const words = text.trim()
  if (!words) return `${link}\n`

  const quoted = words
    .split('\n')
    .map((line) => `> ${line.trim()}`)
    .join('\n')

  return `${quoted}\n\n${link}\n`
}
