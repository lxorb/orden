/** JSON Canvas 1.0, read and written.
 *
 *  The format is somebody else's and it is public: jsoncanvas.org/spec/1.0/. A
 *  canvas Nib writes opens in Obsidian and comes back unchanged, which is the
 *  whole reason for using it, so this module holds the spec and nothing else.
 *  Every field it knows about is a field the spec defines, and nothing it writes
 *  is an invention of ours.
 *
 *  Reading is tolerant and writing is exact, which is the usual division: a file
 *  on disk may have been written by an older app, by a newer one, or by hand, so
 *  what reads as a node becomes one and what does not is left out rather than
 *  taking the whole canvas with it. Writing puts the fields down in the order
 *  the spec lists them and leaves out every one that is absent, so a canvas that
 *  has not changed is written back byte for byte. */

import { isNumber, isRecord, isString } from '../stored'

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

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode
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

/** One canvas. Both arrays are optional in the file and always present here:
 *  everything that reads a canvas wants two lists, and "absent" and "empty" mean
 *  the same thing to all of them. */
export interface Canvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export function emptyCanvas(): Canvas {
  return { nodes: [], edges: [] }
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

/** The colour as a field to spread, so an absent one stays absent rather than
 *  becoming a `color: undefined` that has to be checked for everywhere. */
function colour(value: unknown): { color?: CanvasColour } {
  const found = colourOf(value)
  return found === undefined ? {} : { color: found }
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

  return { nodes, edges }
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

/** The canvas as a file. Tabs and a closing newline, which is how Obsidian
 *  writes one, so a canvas that travels between the two apps and back shows no
 *  diff at all beyond what somebody actually changed. */
export function writeCanvas(canvas: Canvas): string {
  const written = {
    nodes: canvas.nodes.map(writtenNode),
    edges: canvas.edges.map(writtenEdge),
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

/** A fresh id for a node or an edge. Random rather than counted, because two
 *  devices edit one canvas and a counter would have them both hand out `7`.
 *
 *  Stable once written: nothing ever renumbers a node, since every edge names
 *  its ends by id and every merge of two copies of a file relies on the same
 *  card carrying the same name on both. */
export function freshId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH / 2))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
