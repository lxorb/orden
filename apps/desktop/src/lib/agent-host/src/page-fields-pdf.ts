import type { PDFPageProxy } from 'pdfjs-dist'
import type { Box, Mark, Sheet, Widget, Words } from './page-fields'

type Matrix = [number, number, number, number, number, number]
type Ops = Record<string, number>
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
function times(one: readonly number[], other: readonly number[]): Matrix {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = one
  const [g = 1, h = 0, i = 0, j = 1, k = 0, l = 0] = other
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f]
}
function point(matrix: readonly number[], x: number, y: number): [number, number] {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = matrix
  return [a * x + c * y + e, b * x + d * y + f]
}
function boxThrough(matrix: readonly number[], x0: number, y0: number, x1: number, y1: number): Box {
  const corners = [point(matrix, x0, y0), point(matrix, x1, y0), point(matrix, x0, y1), point(matrix, x1, y1)]
  const low = (values: number[]) => values.reduce((one, other) => Math.min(one, other))
  const high = (values: number[]) => values.reduce((one, other) => Math.max(one, other))
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  return { x: low(xs), y: low(ys), width: high(xs) - low(xs), height: high(ys) - low(ys) }
}
const PAINTS = [
  'stroke',
  'closeStroke',
  'fill',
  'eoFill',
  'fillStroke',
  'eoFillStroke',
  'closeFillStroke',
  'closeEOFillStroke',
]
const PICTURES = ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject']
function marksOf(fns: readonly number[], args: readonly unknown[], ops: Ops, view: readonly number[]): Mark[] {
  const paints = new Set(PAINTS.map((name) => ops[name]))
  const pictures = new Set(PICTURES.map((name) => ops[name]))
  const stack: Matrix[] = []
  let now: Matrix = [...IDENTITY]
  const marks: Mark[] = []
  for (const [at, fn] of fns.entries()) {
    const said = (args[at] ?? []) as unknown[]
    if (fn === ops.save) stack.push(now)
    else if (fn === ops.restore) now = stack.pop() ?? now
    else if (fn === ops.transform) now = times(now, said as number[])
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push(now)
      if (Array.isArray(said[0])) now = times(now, said[0] as number[])
    } else if (fn === ops.paintFormXObjectEnd) now = stack.pop() ?? now
    else if (fn === ops.constructPath) {
      const limits = said[2] as ArrayLike<number> | null | undefined
      if (!paints.has(said[0] as number) || !limits || limits.length < 4) continue
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = Array.from(limits)
      if (![x0, y0, x1, y1].every(Number.isFinite)) continue
      marks.push({ box: boxThrough(times(view, now), x0, y0, x1, y1), picture: false })
    } else if (pictures.has(fn)) {
      marks.push({ box: boxThrough(times(view, now), 0, 0, 1, 1), picture: true })
    }
  }
  return marks
}
interface TextItem {
  str?: unknown
  transform?: unknown
  width?: unknown
}
function wordsOf(items: readonly unknown[], view: readonly number[]): Words[] {
  return items.flatMap((item) => {
    const { str, transform, width } = item as TextItem
    if (typeof str !== 'string' || !str.trim() || !Array.isArray(transform)) return []
    const placed = times(view, transform as number[])
    const size = Math.hypot(placed[2], placed[3])
    if (!(size > 0)) return []
    const scale = Math.hypot(view[0] ?? 1, view[1] ?? 0)
    const wide = (typeof width === 'number' ? width : 0) * scale
    const [x, baseline] = [placed[4], placed[5]]
    return [{ text: str, size, box: { x, y: baseline - size * 0.8, width: wide, height: size } }]
  })
}
interface Annotation {
  subtype?: unknown
  fieldType?: unknown
  fieldName?: unknown
  hidden?: unknown
  rect?: unknown
}
function widgetsOf(annotations: readonly unknown[], view: readonly number[]): Widget[] {
  return annotations.flatMap((one) => {
    const { subtype, fieldType, fieldName, hidden, rect } = one as Annotation
    if (subtype !== 'Widget' || fieldType !== 'Tx' || hidden === true || !Array.isArray(rect)) return []
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rect as number[]
    return [{ name: typeof fieldName === 'string' ? fieldName : '', box: boxThrough(view, x0, y0, x1, y1) }]
  })
}
export async function sheetOf(page: PDFPageProxy, ops: Ops): Promise<Sheet> {
  const view = page.getViewport({ scale: 1 })
  const [text, annotations, list] = await Promise.all([
    page.getTextContent(),
    page.getAnnotations({ intent: 'display' }),
    page.getOperatorList(),
  ])
  return {
    width: view.width,
    height: view.height,
    words: wordsOf(text.items, view.transform),
    widgets: widgetsOf(annotations, view.transform),
    marks: marksOf(list.fnArray, list.argsArray, ops, view.transform),
  }
}
