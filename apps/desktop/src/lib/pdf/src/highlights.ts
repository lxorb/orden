import { isRecord, isNumber, isString } from '../../platform/src/api'

export { PDF_SIDECAR as SIDECAR } from '@orden/markdown/links'
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
export const emptySheet = (): Sheet => ({ version: VERSION, highlights: [] })
export const leftAlone = (held: Held): Sheet => ({ version: VERSION, highlights: [], held })
export const frozen = (sheet: Sheet): Held | null => sheet.held ?? (sheet.version > VERSION ? 'newer' : null)
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
const sorted = (highlights: readonly Highlight[]): Highlight[] =>
  [...highlights].sort(
    (one, other) => one.page - other.page || one.created - other.created || (one.id < other.id ? -1 : 1),
  )
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
export const matrixOf = (values: readonly number[]): Transform => [
  values[0] ?? 1,
  values[1] ?? 0,
  values[2] ?? 0,
  values[3] ?? 1,
  values[4] ?? 0,
  values[5] ?? 0,
]
export function toViewport(matrix: Transform): Point {
  const [a, b, c, d, e, f] = matrix
  return (x, y) => [a * x + c * y + e, b * x + d * y + f]
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
