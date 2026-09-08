/** A canvas file, read and written.
 *
 *  Two halves. The first is JSON Canvas 1.0, which is somebody else's and is
 *  public: jsoncanvas.org/spec/1.0/. A canvas Nib writes opens in Obsidian and
 *  comes back unchanged, which is the whole reason for using it, so every field
 *  in that half is a field the spec defines and nothing written there is an
 *  invention of ours.
 *
 *  The second is one top-level key, `nib`, which holds what the spec has no
 *  place for: the ink a pen left, the shapes, when each thing was last touched
 *  and what has been thrown away. Under a key of its own rather than as a fifth
 *  node type, because the spec names four types and a file with a fifth in
 *  `nodes` asks every other reader of the format to guess. Under this key the
 *  file is the spec exactly, plus something no other app has to look at.
 *
 *  Here rather than in the app because three parts of Nib read it: the surface
 *  somebody draws on, the sync client that has to put two copies of a file back
 *  together, and the worker that notices the two copies in the first place. One
 *  reading of the format, so the three cannot drift.
 *
 *  Reading is tolerant and writing is exact, which is the usual division: a file
 *  on disk may have been written by an older app, by a newer one, or by hand, so
 *  what reads as a node becomes one and what does not is left out rather than
 *  taking the whole canvas with it. Writing puts the spec's fields down in the
 *  order the spec lists them and leaves out every one that is absent, so a
 *  canvas that has not changed is written back byte for byte. */

/** A colour, as the spec spells it: one of six presets named `"1"` to `"6"`, or
 *  a hex string. The presets are what Obsidian writes, so a canvas coloured in
 *  either app keeps its colours in the other. */
export type CanvasColour = string

/** The six the spec names, in its order: red, orange, yellow, green, cyan,
 *  purple. What the floating bar offers, and what a file carries. */
export const PRESET_COLOURS = ['1', '2', '3', '4', '5', '6'] as const

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export type Side = 'top' | 'right' | 'bottom' | 'left'
type End = 'none' | 'arrow'
type BackgroundStyle = 'cover' | 'ratio' | 'repeat'

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']
const ENDS: readonly End[] = ['none', 'arrow']
const BACKGROUNDS: readonly BackgroundStyle[] = ['cover', 'ratio', 'repeat']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** What every node has, whichever kind it is. The spec makes all six required
 *  and the position and the size integers. */
interface NodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  color?: CanvasColour
}

interface TextNode extends NodeBase {
  type: 'text'
  /** Plain text, with markdown syntax. */
  text: string
}

interface FileNode extends NodeBase {
  type: 'file'
  /** A path to a file inside the space. */
  file: string
  /** A heading or a block inside that file, beginning with `#`. */
  subpath?: string
}

interface LinkNode extends NodeBase {
  type: 'link'
  url: string
}

interface GroupNode extends NodeBase {
  type: 'group'
  label?: string
  /** A path to an image. */
  background?: string
  backgroundStyle?: BackgroundStyle
}

/** What a shape is. Four, because a rectangle, a ring, a line and an arrow are
 *  what anybody draws beside a card and a fifth would be a drawing program. */
export const SHAPES = ['rect', 'ellipse', 'line', 'arrow'] as const
export type Shape = (typeof SHAPES)[number]

/** A shape: a node like any other in memory, so one drag, one resize and one
 *  snap serve all five kinds, and written under `nib` rather than into `nodes`.
 *
 *  Its box is always the right way up. A line and an arrow run corner to corner
 *  inside it, and `up` says which pair of corners, which is how one box says all
 *  four diagonals. */
interface ShapeNode extends NodeBase {
  type: 'shape'
  shape: Shape
  /** Filled rather than drawn as an outline. */
  fill?: boolean
  /** Bottom left to top right rather than top left to bottom right. */
  up?: boolean
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode | ShapeNode
export type NodeKind = CanvasNode['type']

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  /** `none` unless it says otherwise, which is what the spec says. */
  fromEnd?: End
  toNode: string
  toSide?: Side
  /** `arrow` unless it says otherwise. */
  toEnd?: End
  color?: CanvasColour
  label?: string
}

/** The tools a pen offers. The names are the ones anybody who has held a pen
 *  already knows; what each one does to a line is in the app, beside the paint. */
export const INK_TOOLS = [
  'pen',
  'fountain',
  'pencil',
  'marker',
  'highlighter',
  'brush',
  'calligraphy',
] as const

export type InkTool = (typeof INK_TOOLS)[number]

export function isInkTool(value: unknown): value is InkTool {
  return INK_TOOLS.some((one) => one === value)
}

/** One sample from the digitiser. Tilt is in degrees the way Pointer Events give
 *  it, and `t` is milliseconds since this stroke began rather than a wall clock:
 *  small numbers, and a stroke that means the same thing whenever it is read. */
export interface InkPoint {
  x: number
  y: number
  /** 0 to 1. Half for a device that reports none, which is what the spec says. */
  pressure: number
  tiltX: number
  tiltY: number
  t: number
}

/** A stroke of ink: the points the pen went through, and never a picture of
 *  them. Vectors mean a stroke drawn at one zoom is the same stroke at every
 *  other one, and that an eraser can still cut a line in half years later. */
export interface InkStroke {
  id: string
  tool: InkTool
  color: CanvasColour
  /** The nib's width in plane units, before pressure thins it. */
  size: number
  /** How much of the colour lands, 0 to 1, or absent for however translucent
   *  this kind of pen is by itself. Absent rather than filled in, so a canvas
   *  drawn before anybody could turn the dial reads and writes back unchanged. */
  opacity?: number
  points: InkPoint[]
}

/** One canvas. Every list is optional in the file and always present here:
 *  everything that reads a canvas wants the lists, and "absent" and "empty" mean
 *  the same thing to all of them.
 *
 *  `at` and `gone` are how two devices drawing on one file are put back
 *  together: when each thing was last touched, and what has been thrown away.
 *  They are kept up to date in one place, by `stamped` in canvas-merge.ts,
 *  rather than by every edit remembering to. */
export interface Canvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  ink: InkStroke[]
  at: Record<string, number>
  gone: Record<string, number>
}

export function emptyCanvas(): Canvas {
  return { nodes: [], edges: [], ink: [], at: {}, gone: {} }
}

/** A colour the spec would accept, or undefined. Anything else is dropped rather
 *  than written back out: a value nothing can draw is not a colour. */
function colourOf(value: unknown): CanvasColour | undefined {
  if (!isString(value)) return undefined
  const colour = value.trim()

  return PRESET_COLOURS.some((one) => one === colour) || HEX.test(colour) ? colour : undefined
}

/** A whole number of pixels. The spec says integers, and a node dragged with a
 *  pointer would otherwise land on a fraction of one. */
function pixels(value: unknown, fallback: number): number {
  return isNumber(value) ? Math.round(value) : fallback
}

/** How big a node is when the file forgot to say. Wide enough to read a line of
 *  text in and the same as Obsidian's own new card, so a canvas missing a size
 *  does not come back looking like somebody else's. */
export const DEFAULT_WIDTH = 250
export const DEFAULT_HEIGHT = 60

function one<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((entry) => entry === value)
}

/** The colour as a field to spread, so an absent one stays absent rather than
 *  becoming a `color: undefined` that has to be checked for everywhere. */
function colour(value: unknown): { color?: CanvasColour } {
  const found = colourOf(value)
  return found === undefined ? {} : { color: found }
}

/** One node, once it reads as one. Null for a record with no id, an unknown
 *  type, or nothing where its kind's own field should be: those three are what
 *  make a node a node, and a canvas is better off without a card that cannot say
 *  what it holds. */
function readNode(value: unknown): CanvasNode | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null

  const base: NodeBase = {
    id: value.id,
    x: pixels(value.x, 0),
    y: pixels(value.y, 0),
    width: Math.max(1, pixels(value.width, DEFAULT_WIDTH)),
    height: Math.max(1, pixels(value.height, DEFAULT_HEIGHT)),
    ...colour(value.color),
  }

  switch (value.type) {
    case 'text':
      return isString(value.text) ? { ...base, type: 'text', text: value.text } : null
    case 'file':
      if (!isString(value.file) || !value.file) return null
      return {
        ...base,
        type: 'file',
        file: value.file,
        ...(isString(value.subpath) && value.subpath.startsWith('#')
          ? { subpath: value.subpath }
          : {}),
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

/** One edge, once it reads as one. Both ends have to name a node the canvas
 *  actually holds: an edge into nothing is drawn from nowhere to nowhere. */
function readEdge(value: unknown, nodes: ReadonlySet<string>): CanvasEdge | null {
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

/** The flattened points of every stroke that has been written down, kept.
 *
 *  A canvas is written whole on every edit, and flattening five thousand strokes
 *  that have not changed since the last one is most of the cost of doing so.
 *  Weak and keyed on the stroke, like every other cache in this codebase: a
 *  stroke that changed is a new object, so the answers cannot go stale. */
const flattened = new WeakMap<InkStroke, number[]>()

/** The points of a stroke as they go into a file: flattened, six numbers each,
 *  and rounded to a tenth of a unit, which is finer than any pen is steady.
 *
 *  Flat rather than a list of objects because a page of handwriting is tens of
 *  thousands of points, and `[12.4,88.1,0.6,3,-2,17]` is a third of the bytes of
 *  the same point spelled out. */
export function packed(points: readonly InkPoint[]): number[] {
  const out: number[] = []

  for (const point of points) {
    out.push(
      Math.round(point.x * 10) / 10,
      Math.round(point.y * 10) / 10,
      Math.round(point.pressure * 100) / 100,
      Math.round(point.tiltX),
      Math.round(point.tiltY),
      Math.round(point.t),
    )
  }

  return out
}

export function unpacked(values: readonly number[]): InkPoint[] {
  const out: InkPoint[] = []

  for (let index = 0; index + 5 < values.length; index += 6) {
    out.push({
      x: values[index] ?? 0,
      y: values[index + 1] ?? 0,
      pressure: values[index + 2] ?? 0.5,
      tiltX: values[index + 3] ?? 0,
      tiltY: values[index + 4] ?? 0,
      t: values[index + 5] ?? 0,
    })
  }

  return out
}

function readStroke(value: unknown): InkStroke | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null
  if (!isInkTool(value.tool) || !isString(value.color)) return null
  if (!Array.isArray(value.points)) return null

  const points = unpacked(value.points.filter(isNumber))
  if (points.length < 2) return null

  return {
    id: value.id,
    tool: value.tool,
    color: value.color,
    size: Math.max(0.1, isNumber(value.size) ? value.size : 3),
    ...(isNumber(value.opacity) ? { opacity: clampOpacity(value.opacity) } : {}),
    points,
  }
}

/** An alpha the paint can use. Nought would be a stroke nobody can see or find
 *  again, so the dial and the file agree on a floor. */
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
    x: pixels(value.x, 0),
    y: pixels(value.y, 0),
    width: Math.max(1, pixels(value.width, DEFAULT_WIDTH)),
    height: Math.max(1, pixels(value.height, DEFAULT_WIDTH)),
    ...colour(value.color),
    ...(value.fill === true ? { fill: true } : {}),
    ...(value.up === true ? { up: true } : {}),
  }
}

/** A map of id to a number, with anything that is not one left out. What `at`
 *  and `gone` both are. */
function readTimes(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {}

  const out: Record<string, number> = {}
  for (const [id, when] of Object.entries(value)) {
    if (id && isNumber(when) && when > 0) out[id] = Math.round(when)
  }

  return out
}

/** The nodes back in the order the file remembered, which is the order they
 *  stack in. A node the order does not name keeps its place among the ones it
 *  came with and goes after everything that is named: a canvas Obsidian added a
 *  card to still opens, with the new card on top. */
function inOrder(nodes: readonly CanvasNode[], order: readonly string[]): CanvasNode[] {
  if (!order.length) return [...nodes]

  const places = new Map(order.map((id, index) => [id, index]))
  return nodes
    .map((node, index) => ({ node, at: places.get(node.id) ?? Infinity, index }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at))
    .map((one) => one.node)
}

/** A canvas out of the text of a file. An empty one for a file that is not JSON
 *  at all, which is what a new or a truncated file looks like: an empty plane is
 *  something to draw on, and an error message is not. */
export function readCanvas(text: string): Canvas {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    // Not JSON, or nothing at all. Either way there is no canvas in it.
    return emptyCanvas()
  }

  if (!isRecord(parsed)) return emptyCanvas()

  const nodes: CanvasNode[] = []
  const ids = new Set<string>()

  if (Array.isArray(parsed.nodes)) {
    for (const entry of parsed.nodes) {
      const node = readNode(entry)
      // Two nodes cannot share an id: an edge names its ends by id, and the
      // first of a pair is the one every edge already meant.
      if (!node || ids.has(node.id)) continue

      ids.add(node.id)
      nodes.push(node)
    }
  }

  const nib = isRecord(parsed.nib) ? parsed.nib : {}

  if (Array.isArray(nib.shapes)) {
    for (const entry of nib.shapes) {
      const shape = readShape(entry)
      if (!shape || ids.has(shape.id)) continue

      ids.add(shape.id)
      nodes.push(shape)
    }
  }

  const ink: InkStroke[] = []
  const inked = new Set<string>()

  if (Array.isArray(nib.ink)) {
    for (const entry of nib.ink) {
      const stroke = readStroke(entry)
      if (!stroke || inked.has(stroke.id)) continue

      inked.add(stroke.id)
      ink.push(stroke)
    }
  }

  const edges: CanvasEdge[] = []
  const seen = new Set<string>()

  if (Array.isArray(parsed.edges)) {
    for (const entry of parsed.edges) {
      const edge = readEdge(entry, ids)
      if (!edge || seen.has(edge.id)) continue

      seen.add(edge.id)
      edges.push(edge)
    }
  }

  const order = Array.isArray(nib.order)
    ? nib.order.filter((id): id is string => isString(id) && !!id)
    : []

  return {
    nodes: inOrder(nodes, order),
    edges,
    ink,
    at: readTimes(nib.at),
    gone: readTimes(nib.gone),
  }
}

/** A node with its fields in the order the spec lists them, and nothing else in
 *  it. Written out longhand rather than filtered, so what goes into a file is
 *  read off this module rather than off whatever happened to be in memory. */
function writtenNode(node: CanvasNode): Record<string, unknown> {
  const base = {
    id: node.id,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    ...(node.color === undefined ? {} : { color: node.color }),
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
        ...(node.label === undefined ? {} : { label: node.label }),
        ...(node.background === undefined ? {} : { background: node.background }),
        ...(node.backgroundStyle === undefined ? {} : { backgroundStyle: node.backgroundStyle }),
      }
    case 'shape':
      // Never reached: shapes are taken out before this is called and written
      // under `nib` instead. Here so the switch covers every kind.
      return base
  }
}

function writtenShape(node: ShapeNode): Record<string, unknown> {
  return {
    id: node.id,
    shape: node.shape,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    ...(node.color === undefined ? {} : { color: node.color }),
    ...(node.fill ? { fill: true } : {}),
    ...(node.up ? { up: true } : {}),
  }
}

function writtenStroke(stroke: InkStroke): Record<string, unknown> {
  let points = flattened.get(stroke)
  if (!points) {
    points = packed(stroke.points)
    flattened.set(stroke, points)
  }

  return {
    id: stroke.id,
    tool: stroke.tool,
    color: stroke.color,
    size: Math.round(stroke.size * 100) / 100,
    ...(stroke.opacity === undefined ? {} : { opacity: clampOpacity(stroke.opacity) }),
    points,
  }
}

function writtenEdge(edge: CanvasEdge): Record<string, unknown> {
  return {
    id: edge.id,
    fromNode: edge.fromNode,
    ...(edge.fromSide === undefined ? {} : { fromSide: edge.fromSide }),
    ...(edge.fromEnd === undefined ? {} : { fromEnd: edge.fromEnd }),
    toNode: edge.toNode,
    ...(edge.toSide === undefined ? {} : { toSide: edge.toSide }),
    ...(edge.toEnd === undefined ? {} : { toEnd: edge.toEnd }),
    ...(edge.color === undefined ? {} : { color: edge.color }),
    ...(edge.label === undefined ? {} : { label: edge.label }),
  }
}

/** The same map with its keys in order, so a canvas that has not changed is
 *  written back byte for byte however the map was built. */
function sortedTimes(times: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(times).sort(([a], [b]) => (a < b ? -1 : 1)))
}

/** How the parts of a canvas that are not the spec's are written. Bumped only
 *  when an older Nib could no longer read a newer file, which so far it can. */
const NIB_VERSION = 1

/** The canvas as a file. Tabs and a closing newline, which is how Obsidian
 *  writes one, so a canvas that travels between the two apps and back shows no
 *  diff at all beyond what somebody actually changed.
 *
 *  Nothing of ours is written into a canvas that has none: a plane of plain
 *  cards is exactly the file the spec describes, with no key of Nib's in it. */
export function writeCanvas(canvas: Canvas): string {
  const shapes = canvas.nodes.filter((node): node is ShapeNode => node.type === 'shape')
  const ink = canvas.ink.map(writtenStroke)
  // Worth writing only when something is not where the spec would put it: a
  // canvas of nothing but cards stacks in the order `nodes` already gives, and
  // a second list saying so again is noise in the file.
  const order = shapes.length ? canvas.nodes.map((node) => node.id) : []

  const nib = {
    ...(ink.length ? { ink } : {}),
    ...(shapes.length ? { shapes: shapes.map(writtenShape) } : {}),
    ...(order.length ? { order } : {}),
    ...(Object.keys(canvas.at).length ? { at: sortedTimes(canvas.at) } : {}),
    ...(Object.keys(canvas.gone).length ? { gone: sortedTimes(canvas.gone) } : {}),
  }

  const written = {
    nodes: canvas.nodes.filter((node) => node.type !== 'shape').map(writtenNode),
    edges: canvas.edges.map(writtenEdge),
    ...(Object.keys(nib).length ? { nib: { version: NIB_VERSION, ...nib } } : {}),
  }

  return `${JSON.stringify(written, null, '\t')}\n`
}

/** What a canvas file says before anybody has drawn on it. */
export function blankCanvas(): string {
  return writeCanvas(emptyCanvas())
}

/** How long an id is. Sixteen hex characters is what Obsidian writes, so a
 *  canvas Nib made looks native there rather than obviously foreign. */
const ID_LENGTH = 16

/** A fresh id for anything on a canvas. Random rather than counted, because two
 *  devices edit one canvas and a counter would have them both hand out `7`.
 *
 *  Stable once written: nothing ever renumbers a node, since every edge names
 *  its ends by id and every merge of two copies of a file relies on the same
 *  card carrying the same name on both. */
export function freshId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH / 2))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
