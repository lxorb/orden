import { type Extras, extrasFrom, holdsExtras, ownOf, withExtras } from './canvas-extras'
import { oneEdit, type TextEdit } from './edits'
import { isPaper, type Paper, PAPERS } from './papers'

export type CanvasColour = string
export const PRESET_COLOURS = ['1', '2', '3', '4', '5', '6'] as const
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
export type Side = 'top' | 'right' | 'bottom' | 'left'
type End = 'none' | 'arrow'
type BackgroundStyle = 'cover' | 'ratio' | 'repeat'
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']
const ENDS: readonly End[] = ['none', 'arrow']
const BACKGROUNDS: readonly BackgroundStyle[] = ['cover', 'ratio', 'repeat']
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
interface NodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  color?: CanvasColour
  locked?: true
}
interface TextNode extends NodeBase {
  type: 'text'
  text: string
  bare?: true
}
interface FileNode extends NodeBase {
  type: 'file'
  file: string
  subpath?: string
}
interface LinkNode extends NodeBase {
  type: 'link'
  url: string
}
interface GroupNode extends NodeBase {
  type: 'group'
  label?: string
  background?: string
  backgroundStyle?: BackgroundStyle
}
export const SHAPES = ['rect', 'ellipse', 'rhombus', 'triangle', 'line', 'arrow', 'elbow'] as const
export type Shape = (typeof SHAPES)[number]
export const isShape = (value: unknown): value is Shape => SHAPES.some((one) => one === value)
interface ShapeNode extends NodeBase {
  type: 'shape'
  shape: Shape
  fill?: boolean
  up?: boolean
  text?: string
}
export { endless, isPaper, type Paper, PAPER_NAMES, PAPERS, paperSized } from './papers'
export const PATTERNS = ['blank', 'lines', 'grid', 'dots'] as const
export type Pattern = (typeof PATTERNS)[number]
export const isPattern = (value: unknown): value is Pattern => PATTERNS.some((one) => one === value)
interface PageNode extends NodeBase {
  type: 'page'
  paper: Paper
  pattern: Pattern
  file?: string
  page?: number
}
export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode | ShapeNode | PageNode
export type NodeKind = CanvasNode['type']
export const isPage = (node: CanvasNode): node is PageNode => node.type === 'page'
export type { PageNode }
export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  fromEnd?: End
  toNode: string
  toSide?: Side
  toEnd?: End
  color?: CanvasColour
  label?: string
}
export const INK_TOOLS = ['pen', 'fountain', 'pencil', 'marker', 'highlighter', 'brush', 'calligraphy'] as const
export type InkTool = (typeof INK_TOOLS)[number]
export const isInkTool = (value: unknown): value is InkTool => INK_TOOLS.some((one) => one === value)
export interface InkPoint {
  x: number
  y: number
  pressure: number
  tiltX: number
  tiltY: number
  t: number
}
export interface InkStroke {
  id: string
  tool: InkTool
  color: CanvasColour
  size: number
  opacity?: number
  points: InkPoint[]
}
export interface Canvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  ink: InkStroke[]
  at: Record<string, number>
  gone: Record<string, number>
  moved?: Record<string, number>
  icon?: string | null
  iconColor?: string | null
  extras?: Extras
}
export const emptyCanvas = (): Canvas => ({
  nodes: [],
  edges: [],
  ink: [],
  at: noTimes(),
  gone: noTimes(),
  icon: null,
  iconColor: null,
})
function colourOf(value: unknown): CanvasColour | undefined {
  if (!isString(value)) return undefined
  const colour = value.trim()
  return PRESET_COLOURS.some((one) => one === colour) || HEX.test(colour) ? colour : undefined
}
export const FURTHEST = 1e9
const held = (value: number): number => Math.min(FURTHEST, Math.max(-FURTHEST, value))
const pixels = (value: unknown, fallback: number): number => (isNumber(value) ? held(Math.round(value)) : fallback)
export const DEFAULT_WIDTH = 250
export const DEFAULT_HEIGHT = 60
const one = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  allowed.find((entry) => entry === value)
function colour(value: unknown): { color?: CanvasColour } {
  const found = colourOf(value)
  return found === undefined ? {} : { color: found }
}
const placed = (value: Record<string, unknown>, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) => ({
  x: pixels(value.x, 0),
  y: pixels(value.y, 0),
  width: Math.max(1, pixels(value.width, width)),
  height: Math.max(1, pixels(value.height, height)),
  ...colour(value.color),
})
function readNode(value: unknown): CanvasNode | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null
  const base: NodeBase = {
    id: value.id,
    ...placed(value),
    ...(value.locked === true ? { locked: true } : {}),
  }
  switch (value.type) {
    case 'text':
      return isString(value.text)
        ? {
            ...base,
            type: 'text',
            text: value.text,
            ...(value.bare === true ? { bare: true } : {}),
          }
        : null
    case 'file':
      if (!isString(value.file) || !value.file) return null
      return {
        ...base,
        type: 'file',
        file: value.file,
        ...(isString(value.subpath) && value.subpath.startsWith('#') ? { subpath: value.subpath } : {}),
      }
    case 'link':
      if (!isString(value.url) || !value.url) return null
      return { ...base, type: 'link', url: value.url }
    case 'group': {
      const style = one(value.backgroundStyle, BACKGROUNDS)
      return {
        ...base,
        type: 'group',
        ...(isString(value.label) ? { label: value.label } : {}),
        ...(isString(value.background) ? { background: value.background } : {}),
        ...(style ? { backgroundStyle: style } : {}),
      }
    }
    default:
      return null
  }
}
export function edgeOf(value: unknown, nodes: ReadonlySet<string>): CanvasEdge | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null
  if (!isString(value.fromNode) || !isString(value.toNode)) return null
  if (!nodes.has(value.fromNode) || !nodes.has(value.toNode)) return null
  const fromSide = one(value.fromSide, SIDES)
  const toSide = one(value.toSide, SIDES)
  const fromEnd = one(value.fromEnd, ENDS)
  const toEnd = one(value.toEnd, ENDS)
  return {
    id: value.id,
    fromNode: value.fromNode,
    ...(fromSide ? { fromSide } : {}),
    ...(fromEnd ? { fromEnd } : {}),
    toNode: value.toNode,
    ...(toSide ? { toSide } : {}),
    ...(toEnd ? { toEnd } : {}),
    ...colour(value.color),
    ...(isString(value.label) ? { label: value.label } : {}),
  }
}
const or = (value: number, otherwise: number): number => (Number.isFinite(value) ? value : otherwise)
export function packed(points: readonly InkPoint[]): number[] {
  const out: number[] = []
  for (const point of points) {
    out.push(
      or(Math.round(point.x * 10) / 10, 0),
      or(Math.round(point.y * 10) / 10, 0),
      or(Math.round(point.pressure * 100) / 100, 0.5),
      or(Math.round(point.tiltX), 0),
      or(Math.round(point.tiltY), 0),
      or(Math.round(point.t), 0),
    )
  }
  return out
}
export function unpacked(values: readonly (number | null)[]): InkPoint[] {
  const out: InkPoint[] = []
  for (let index = 0; index + 5 < values.length; index += 6) {
    out.push({
      x: held(values[index] ?? 0),
      y: held(values[index + 1] ?? 0),
      pressure: Math.min(1, Math.max(0, values[index + 2] ?? 0.5)),
      tiltX: Math.min(90, Math.max(-90, values[index + 3] ?? 0)),
      tiltY: Math.min(90, Math.max(-90, values[index + 4] ?? 0)),
      t: Math.max(0, held(values[index + 5] ?? 0)),
    })
  }
  return out
}
export const DEFAULT_INK = 'ink'
function inkColourOf(value: unknown): CanvasColour {
  if (value === DEFAULT_INK) return DEFAULT_INK
  return colourOf(value) ?? DEFAULT_INK
}
export function strokeOf(value: unknown): InkStroke | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null
  if (!isInkTool(value.tool) || !isString(value.color)) return null
  if (!Array.isArray(value.points)) return null
  const points = unpacked(value.points.map((one) => (isNumber(one) ? one : null)))
  if (points.length === 0) return null
  return {
    id: value.id,
    tool: value.tool,
    color: inkColourOf(value.color),
    size: Math.min(FURTHEST, Math.max(0.1, isNumber(value.size) ? value.size : 3)),
    ...(isNumber(value.opacity) ? { opacity: clampOpacity(value.opacity) } : {}),
    points,
  }
}
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0.05, Math.round(value * 100) / 100))
}
function readShape(value: unknown): ShapeNode | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null
  const shape = one(value.shape, SHAPES)
  if (!shape) return null
  return {
    id: value.id,
    type: 'shape',
    shape,
    ...placed(value),
    ...(value.locked === true ? { locked: true } : {}),
    ...(value.fill === true ? { fill: true } : {}),
    ...(value.up === true ? { up: true } : {}),
    ...(isString(value.text) && value.text ? { text: value.text } : {}),
  }
}
function readPageRecord(value: unknown): { id: string; paper: Paper; pattern: Pattern } | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null
  return {
    id: value.id,
    paper: isPaper(value.paper) ? value.paper : 'a4',
    pattern: isPattern(value.pattern) ? value.pattern : 'blank',
  }
}
function asPage(node: CanvasNode, record: { paper: Paper; pattern: Pattern }): PageNode | null {
  if (node.type !== 'file' && node.type !== 'group') return null
  const page = node.type === 'file' ? pageOfSubpath(node.subpath) : null
  return {
    id: node.id,
    type: 'page',
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    ...(node.color === undefined ? {} : { color: node.color }),
    paper: record.paper,
    pattern: record.pattern,
    ...(node.type === 'file' && page !== null ? { file: node.file, page } : {}),
  }
}
export function pageOfSubpath(subpath: string | undefined): number | null {
  const digits = /^#page=(\d+)$/i.exec((subpath ?? '').trim())?.[1]
  if (digits === undefined) return null
  const page = Number(digits)
  return Number.isInteger(page) && page > 0 ? page : null
}
function readPage(value: unknown): PageNode | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null
  const page = isNumber(value.page) ? Math.floor(value.page) : 0
  const file = isString(value.file) ? value.file : ''
  return {
    id: value.id,
    type: 'page',
    ...placed(value, PAPERS.a4.width, PAPERS.a4.height),
    paper: isPaper(value.paper) ? value.paper : 'a4',
    pattern: isPattern(value.pattern) ? value.pattern : 'blank',
    ...(file && page > 0 ? { file, page } : {}),
  }
}
function asSpecNode(page: PageNode, at: number): CanvasNode {
  const base = {
    id: page.id,
    x: page.x,
    y: page.y,
    width: page.width,
    height: page.height,
    ...(page.color === undefined ? {} : { color: page.color }),
  }
  if (page.file && page.page) {
    return { ...base, type: 'file', file: page.file, subpath: `#page=${page.page}` }
  }
  return { ...base, type: 'group', label: `Page ${at + 1}` }
}
const writtenPage = (page: PageNode): Record<string, unknown> => ({
  id: page.id,
  paper: page.paper,
  pattern: page.pattern,
})
export const noTimes = (): Record<string, number> => Object.create(null) as Record<string, number>
export const timeIn = (times: Readonly<Record<string, number>>, id: string): number | undefined =>
  Object.hasOwn(times, id) ? times[id] : undefined
function readTimes(value: unknown): Record<string, number> {
  if (!isRecord(value)) return noTimes()
  const out = noTimes()
  for (const [id, when] of Object.entries(value)) {
    if (id && isNumber(when) && when > 0) out[id] = Math.round(when)
  }
  return out
}
function movesIn(value: unknown): { moved?: Record<string, number> } {
  const moved = readTimes(value)
  return Object.keys(moved).length ? { moved } : {}
}
function inOrder(nodes: readonly CanvasNode[], order: readonly string[]): CanvasNode[] {
  if (!order.length) return [...nodes]
  const places = new Map(order.map((id, index) => [id, index]))
  return nodes
    .map((node, index) => ({ node, at: places.get(node.id) ?? Infinity, index }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at))
    .map((one) => one.node)
}
export type Thing = CanvasNode | CanvasEdge | InkStroke
export function nodeOf(value: unknown): CanvasNode | null {
  if (isRecord(value) && value.type === 'shape') return readShape(value)
  if (isRecord(value) && value.type === 'page') return readPage(value)
  return readNode(value)
}
export const readCanvas = (text: string): Canvas => canvasIn(text) ?? emptyCanvas()
export function holdsCanvas(text: string): boolean {
  if (!text.trim()) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return false
  }
  if (!isRecord(parsed)) return false
  const { nodes, edges } = parsed
  if (nodes === undefined && edges === undefined) return false
  return (nodes === undefined || Array.isArray(nodes)) && (edges === undefined || Array.isArray(edges))
}
function apart(file: Record<string, unknown>): Record<string, unknown> {
  const taken = new Set<string>()
  const counted = new Map<string, number>()
  const kept = (list: unknown, kind: string): unknown => {
    if (!Array.isArray(list)) return list
    const out: unknown[] = list.map((entry: unknown) => {
      if (!isRecord(entry) || !isString(entry.id) || !entry.id) return entry
      if (!taken.has(entry.id)) {
        taken.add(entry.id)
        return entry
      }
      const base = `${entry.id}-${kind}`
      let id = base
      for (let count = counted.get(base) ?? 2; taken.has(id); count++) {
        id = `${base}-${String(count)}`
        counted.set(base, count + 1)
      }
      taken.add(id)
      return { ...entry, id }
    })
    return out.some((one, at) => one !== list[at]) ? out : list
  }
  const nodes = kept(file.nodes, 'card')
  const own = ownOf(file) ?? null
  const key = own ? Object.keys(file).find((name) => file[name] === own) : undefined
  const shapes = own ? kept(own.shapes, 'shape') : undefined
  const edges = kept(file.edges, 'line')
  const ink = own ? kept(own.ink, 'stroke') : undefined
  const ownChanged = own !== null && (shapes !== own.shapes || ink !== own.ink)
  if (nodes === file.nodes && edges === file.edges && !ownChanged) return file
  return {
    ...file,
    nodes,
    edges,
    ...(key && ownChanged ? { [key]: { ...own, shapes, ink } } : {}),
  }
}
function firstOfEach<T extends { id: string }>(
  list: unknown,
  read: (entry: unknown) => T | null,
  ids: Set<string>,
  into: T[],
): void {
  if (!Array.isArray(list)) return
  for (const entry of list) {
    const one = read(entry)
    if (one && !ids.has(one.id)) {
      ids.add(one.id)
      into.push(one)
    }
  }
}
export function canvasIn(text: string): Canvas | null {
  if (!text.trim()) return emptyCanvas()
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const file = apart(parsed)
  const nodes: CanvasNode[] = []
  const ids = new Set<string>()
  firstOfEach(file.nodes, readNode, ids, nodes)
  const own = ownOf(file) ?? {}
  if (Array.isArray(own.words)) {
    const bare = new Set(own.words.filter(isString))
    for (const [at, node] of nodes.entries()) {
      if (node.type === 'text' && bare.has(node.id)) nodes[at] = { ...node, bare: true }
    }
  }
  firstOfEach(own.shapes, readShape, ids, nodes)
  const ink: InkStroke[] = []
  const inked = new Set<string>()
  firstOfEach(own.ink, strokeOf, inked, ink)
  const edges: CanvasEdge[] = []
  const seen = new Set<string>()
  firstOfEach(file.edges, (entry) => edgeOf(entry, ids), seen, edges)
  const order = Array.isArray(own.order) ? own.order.filter((id): id is string => isString(id) && !!id) : []
  if (Array.isArray(own.pages)) {
    const paged = new Map<string, { paper: Paper; pattern: Pattern }>()
    for (const entry of own.pages) {
      const record = readPageRecord(entry)
      if (record && !paged.has(record.id)) paged.set(record.id, record)
    }
    for (const [at, node] of nodes.entries()) {
      const record = paged.get(node.id)
      const page = record ? asPage(node, record) : null
      if (page) nodes[at] = page
    }
  }
  if (Array.isArray(own.locked)) {
    const held = new Set(own.locked.filter(isString))
    for (const [at, node] of nodes.entries()) {
      if (held.has(node.id)) nodes[at] = { ...node, locked: true }
    }
  }
  const extras = extrasFrom(file, ids, seen, inked)
  return {
    nodes: inOrder(nodes, order),
    edges,
    ink,
    at: readTimes(own.at),
    gone: readTimes(own.gone),
    ...movesIn(own.moved),
    icon: iconWritten(own.icon),
    iconColor: iconWritten(own.iconColor),
    ...(holdsExtras(extras) ? { extras } : {}),
  }
}
function iconWritten(value: unknown): string | null {
  if (!isString(value)) return null
  return value.trim() || null
}
function writtenNode(node: CanvasNode): Record<string, unknown> {
  const base = {
    id: node.id,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    color: node.color,
  }
  switch (node.type) {
    case 'text':
      return { ...base, text: node.text }
    case 'file':
      return { ...base, file: node.file, ...(node.subpath ? { subpath: node.subpath } : {}) }
    case 'link':
      return { ...base, url: node.url }
    case 'group':
      return {
        ...base,
        label: node.label,
        background: node.background,
        backgroundStyle: node.backgroundStyle,
      }
    case 'shape':
    case 'page':
      return base
  }
}
const writtenShape = (node: ShapeNode): Record<string, unknown> => ({
  id: node.id,
  shape: node.shape,
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height,
  color: node.color,
  fill: node.fill ? true : undefined,
  up: node.up ? true : undefined,
  text: node.text,
})
const writtenStroke = (stroke: InkStroke): Record<string, unknown> => ({
  id: stroke.id,
  tool: stroke.tool,
  color: stroke.color,
  size: Math.round(stroke.size * 100) / 100,
  ...(stroke.opacity === undefined ? {} : { opacity: clampOpacity(stroke.opacity) }),
  points: packed(stroke.points),
})
const writtenEdge = (edge: CanvasEdge): Record<string, unknown> => {
  const { id, fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label } = edge
  return { id, fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label }
}
const ORDEN_VERSION = 1
const TABS = ['', '\t', '\t\t', '\t\t\t']
const printed = (value: unknown, depth: number): string =>
  JSON.stringify(value, null, '\t')
    .split('\n')
    .join(`\n${TABS[depth] ?? ''}`)
function kept<T extends object>(depth: number, fields: (thing: T) => unknown) {
  const texts = new WeakMap<T, string>()
  return (thing: T): string => {
    let text = texts.get(thing)
    if (text === undefined) {
      text = printed(fields(thing), depth)
      texts.set(thing, text)
    }
    return text
  }
}
const cardText = kept<CanvasNode>(2, writtenNode)
const edgeText = kept<CanvasEdge>(2, writtenEdge)
const pageText = kept<PageNode>(3, writtenPage)
const strokeText = kept<InkStroke>(3, writtenStroke)
const shapeText = kept<ShapeNode>(3, writtenShape)
export function printStrokes(strokes: readonly InkStroke[]): void {
  for (const stroke of strokes) strokeText(stroke)
}
function listed(texts: readonly string[], depth: number): string[] {
  const between = `,\n${TABS[depth + 1] ?? ''}`
  const out: string[] = []
  for (const text of texts) {
    if (out.length) out.push(between)
    out.push(text)
  }
  return out
}
const isIndex = (key: string): boolean => /^(?:0|[1-9]\d{0,9})$/.test(key) && Number(key) < 2 ** 32 - 1
function timeLines(times: Record<string, number>): string[] {
  const keys = Object.keys(times).sort()
  const first = keys.filter(isIndex)
  const ordered = first.length
    ? [...first.sort((one, other) => Number(one) - Number(other)), ...keys.filter((key) => !isIndex(key))]
    : keys
  const out = ['{\n']
  const last = ordered.length - 1
  ordered.forEach((key, at) => {
    const line = `\t\t\t${JSON.stringify(key)}: ${JSON.stringify(times[key])}`
    out.push(at < last ? `${line},\n` : `${line}\n`)
  })
  out.push('\t\t}')
  return out
}
export const CANVAS_RUNS = 15
export function canvasRuns(canvas: Canvas): string[][] {
  const runs = ownRuns(canvas)
  if (!holdsExtras(canvas.extras)) return runs
  const text = withExtras(runs.map((run) => run.join('')).join(''), canvas.extras)
  return [[text], ...Array.from({ length: CANVAS_RUNS - 1 }, () => [])]
}
function ownRuns(canvas: Canvas): string[][] {
  const shapes = canvas.nodes.filter((node): node is ShapeNode => node.type === 'shape')
  const pages = canvas.nodes.filter(isPage)
  let numbered = -1
  const cards = canvas.nodes
    .filter((node) => node.type !== 'shape')
    .map((node) => (isPage(node) ? printed(writtenNode(asSpecNode(node, ++numbered)), 2) : cardText(node)))
  const edges = canvas.edges.map(edgeText)
  const order = shapes.length ? canvas.nodes.map((node) => node.id) : []
  const words = canvas.nodes.filter((node) => node.type === 'text' && node.bare).map((node) => node.id)
  const locked = canvas.nodes.filter((node) => node.locked).map((node) => node.id)
  const at = Object.keys(canvas.at).length ? timeLines(canvas.at) : null
  const gone = Object.keys(canvas.gone).length ? timeLines(canvas.gone) : null
  const moved = canvas.moved && Object.keys(canvas.moved).length ? timeLines(canvas.moved) : null
  const icon = canvas.icon ? `,\n\t\t"icon": ${JSON.stringify(canvas.icon)}` : ''
  const tint = canvas.icon && canvas.iconColor ? `,\n\t\t"iconColor": ${JSON.stringify(canvas.iconColor)}` : ''
  const owned =
    icon !== '' ||
    [pages, canvas.ink, shapes, order, words, locked].some((list) => list.length > 0) ||
    at !== null ||
    gone !== null ||
    moved !== null
  const opens = (key: string, depth: number, count: number, always = false) =>
    count ? `,\n${TABS[depth]}"${key}": [\n${TABS[depth + 1]}` : always ? `,\n\t"${key}": []` : ''
  const closes = (depth: number, count: number) => (count ? `\n${TABS[depth]}]` : '')
  return [
    [cards.length ? '{\n\t"nodes": [\n\t\t' : '{\n\t"nodes": []'],
    listed(cards, 1),
    [closes(1, cards.length) + opens('edges', 1, edges.length, true)],
    listed(edges, 1),
    [
      closes(1, edges.length) +
        (owned ? `,\n\t"orden": {\n\t\t"version": ${ORDEN_VERSION}${icon}${tint}` : '') +
        opens('pages', 2, pages.length),
    ],
    listed(pages.map(pageText), 2),
    [closes(2, pages.length) + opens('ink', 2, canvas.ink.length)],
    listed(canvas.ink.map(strokeText), 2),
    [closes(2, canvas.ink.length) + opens('shapes', 2, shapes.length)],
    listed(shapes.map(shapeText), 2),
    [
      closes(2, shapes.length) +
        (order.length ? `,\n\t\t"order": ${printed(order, 2)}` : '') +
        (words.length ? `,\n\t\t"words": ${printed(words, 2)}` : '') +
        (locked.length ? `,\n\t\t"locked": ${printed(locked, 2)}` : '') +
        (at ? ',\n\t\t"at": ' : ''),
    ],
    at ?? [],
    [gone ? ',\n\t\t"gone": ' : ''],
    [...(gone ?? []), ...(moved ? [',\n\t\t"moved": ', ...moved] : [])],
    [owned ? '\n\t}\n}\n' : '\n}\n'],
  ]
}
export const writeCanvas = (canvas: Canvas): string =>
  canvasRuns(canvas)
    .map((run) => run.join(''))
    .join('')
export const blankCanvas = (): string => writeCanvas(emptyCanvas())
export function canvasIconEdit(text: string, name: string | null, tint: string | null = null): TextEdit | null {
  if (text.trim() && !isCanvasJson(text)) return null
  const canvas = readCanvas(text)
  const wanted = tint === null || name === null ? null : tint
  if (canvas.icon === name && (canvas.iconColor ?? null) === wanted) return null
  if (!text.trim()) return oneEdit(text, writeCanvas({ ...canvas, icon: name, iconColor: wanted }))
  const file = JSON.parse(text) as Record<string, unknown>
  const rest: Record<string, unknown> = { ...ownOf(file) }
  const version = rest.version ?? ORDEN_VERSION
  delete rest.version
  delete rest.icon
  delete rest.iconColor
  const own: Record<string, unknown> = {
    version,
    ...(name ? { icon: name } : {}),
    ...(name && wanted ? { iconColor: wanted } : {}),
    ...rest,
  }
  delete file.nib
  if (Object.keys(own).length > 1) file.orden = own
  else delete file.orden
  return oneEdit(text, `${JSON.stringify(file, null, '\t')}\n`)
}
function isCanvasJson(text: string): boolean {
  try {
    return isRecord(JSON.parse(text))
  } catch {
    return false
  }
}
const ID_LENGTH = 16
export function freshId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH / 2))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
let waiting: { text: string; canvas: Canvas } | null = null
export function parseAhead(text: string): boolean {
  const canvas = canvasIn(text)
  waiting = canvas ? { text, canvas } : null
  return canvas !== null
}
export function takeParsed(text: string): Canvas | null {
  const held = waiting?.text === text ? waiting.canvas : null
  if (held) waiting = null
  return held
}
export function forgetParsed(): void {
  waiting = null
}
