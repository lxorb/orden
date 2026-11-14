import { type Camera, SMALLEST_DOT } from '../../camera/src/api'
import type { NoteGraph } from '../../graph/src/api'
import { shownName } from '@orden/markdown/note-name'

export function radiusOf(degree: number): number {
  return 3 + Math.min(7, Math.sqrt(degree))
}

const DIMMED = 0.16

const SQUARE = 0.88

const LABELS_FROM = 0.55
const LABELS_FULL = 0.85

const MOST_LABELS = 400

const LABEL_SIZE = 11

const LINES: readonly { wide: number; brush: readonly (readonly [number, number])[] }[] = [
  { wide: 0.6, brush: [[0, 0]] },
  { wide: 1, brush: [[0, 0]] },
  {
    wide: 1,
    brush: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  },
]

const LIT_LINES: readonly number[] = [1.2, 2, 4]

const HAIRLINE = 1

const RING_PIXELS = 2

const ARROWS_FROM = 0.4
const HEAD_LONG = 7
const HEAD_WIDE = 3

export interface GraphColours {
  edge: string
  litEdge: string
  node: string
  hollow: string
  current: string
  label: string
  font: string
  groups: string[]
}

export interface GraphView {
  graph: NoteGraph
  x: Float64Array
  y: Float64Array
  radii: Float64Array
  camera: Camera
  width: number
  height: number
  colours: GraphColours
  current: number
  hovered: number
  lit: Uint8Array
  shown: Uint8Array
  tint: Int8Array
  arrows: boolean
  lines: number
  fade: number
  ratio: number
}

export function paint(context: CanvasRenderingContext2D, view: GraphView) {
  const { graph, x, y, radii, camera, width, height, colours, current, hovered, lit } = view
  const { shown, tint, arrows, ratio } = view
  const highlighting = hovered >= 0
  const hair = 1 / Math.max(1, ratio)
  const step = Math.min(LINES.length, Math.max(1, Math.round(view.lines || 2))) - 1
  const line = LINES[step] ?? LINES[1]

  const scale = camera.scale
  const offsetX = width / 2 - camera.x * scale
  const offsetY = height / 2 - camera.y * scale
  const screenX = (one: number) => (x[one] ?? 0) * scale + offsetX
  const screenY = (one: number) => (y[one] ?? 0) * scale + offsetY

  const margin = 40

  const edges = new Path2D()
  const litEdges = new Path2D()
  const heads = arrows && scale >= ARROWS_FROM ? new Path2D() : null

  for (const edge of graph.edges) {
    if (!shown[edge.a] || !shown[edge.b]) continue

    const ax = screenX(edge.a)
    const ay = screenY(edge.a)
    const bx = screenX(edge.b)
    const by = screenY(edge.b)

    if (Math.max(ax, bx) < -margin || Math.min(ax, bx) > width + margin) continue
    if (Math.max(ay, by) < -margin || Math.min(ay, by) > height + margin) continue

    const path = highlighting && (lit[edge.a] === 2 || lit[edge.b] === 2) ? litEdges : edges
    path.moveTo(ax, ay)
    path.lineTo(bx, by)

    if (!heads) continue
    head(heads, ax, ay, bx, by, Math.max(SMALLEST_DOT, (radii[edge.b] ?? 0) * scale))
    if (edge.both) {
      head(heads, bx, by, ax, ay, Math.max(SMALLEST_DOT, (radii[edge.a] ?? 0) * scale))
    }
  }

  context.lineWidth = (line?.wide ?? 1) * hair
  context.strokeStyle = colours.edge
  context.globalAlpha = highlighting ? DIMMED : 1
  brushed(context, edges, line?.brush ?? [[0, 0]], hair)
  if (heads) {
    context.fillStyle = colours.edge
    context.fill(heads)
  }

  if (highlighting) {
    context.lineWidth = (LIT_LINES[step] ?? 2) * hair
    context.strokeStyle = colours.litEdge
    context.globalAlpha = 1
    context.stroke(litEdges)
  }

  const plain = new Path2D()
  const litPlain = new Path2D()
  const hollow = new Path2D()
  const litHollow = new Path2D()
  const here = new Path2D()
  const litHere = new Path2D()
  const files = new Path2D()
  const litFiles = new Path2D()
  const naming: number[] = []
  const namesFrom = LABELS_FROM * (view.fade || 1)
  const namesFull = LABELS_FULL * (view.fade || 1)
  const labelling = scale >= namesFrom
  const grouped: (Path2D | undefined)[] = []
  const litGrouped: (Path2D | undefined)[] = []

  for (let one = 0; one < graph.nodes.length; one++) {
    if (!shown[one]) continue

    const px = screenX(one)
    const py = screenY(one)
    if (px < -margin || px > width + margin || py < -margin || py > height + margin) continue

    const radius = Math.max(SMALLEST_DOT, (radii[one] ?? 0) * scale)
    const brought = highlighting && lit[one] !== 0
    const group = tint[one] ?? -1

    const node = graph.nodes[one]
    const attached = node?.attachment === true

    const path = attached
      ? brought
        ? litFiles
        : files
      : one === current
        ? brought
          ? litHere
          : here
        : group >= 0 && node?.path !== null
          ? brought
            ? (litGrouped[group] ??= new Path2D())
            : (grouped[group] ??= new Path2D())
          : node?.path === null
            ? brought
              ? litHollow
              : hollow
            : brought
              ? litPlain
              : plain

    if (attached) {
      const side = radius * SQUARE
      path.rect(px - side, py - side, side * 2, side * 2)
    } else {
      path.moveTo(px + radius, py)
      path.arc(px, py, radius, 0, Math.PI * 2)
    }

    if (labelling && naming.length < MOST_LABELS) naming.push(one)
  }

  context.globalAlpha = highlighting ? DIMMED : 1
  fill(context, plain, colours.node)
  fill(context, files, colours.node)
  fill(context, here, colours.current)
  outline(context, hollow, colours.hollow, hair)
  fillGroups(context, grouped, colours.groups)

  if (highlighting) {
    context.globalAlpha = 1
    fill(context, litPlain, colours.node)
    fill(context, litFiles, colours.node)
    fill(context, litHere, colours.current)
    outline(context, litHollow, colours.hollow, hair)
    fillGroups(context, litGrouped, colours.groups)
  }

  if (current >= 0 && shown[current]) {
    const px = screenX(current)
    const py = screenY(current)
    const radius = Math.max(SMALLEST_DOT, (radii[current] ?? 0) * scale)

    context.globalAlpha = highlighting && lit[current] === 0 ? DIMMED : 1
    context.strokeStyle = colours.current
    context.lineWidth = Math.max(1.2, RING_PIXELS * hair)
    context.beginPath()
    context.arc(px, py, radius + 3.5, 0, Math.PI * 2)
    context.stroke()
  }

  if (!labelling) {
    context.globalAlpha = 1
    return
  }

  context.font = `${LABEL_SIZE}px ${colours.font}`
  context.textAlign = 'center'
  context.textBaseline = 'top'
  context.fillStyle = colours.label

  const arriving = Math.min(1, (scale - namesFrom) / (namesFull - namesFrom))

  for (const one of naming) {
    context.globalAlpha = (highlighting && lit[one] === 0 ? DIMMED : 1) * arriving
    const radius = Math.max(SMALLEST_DOT, (radii[one] ?? 0) * scale)
    const name = graph.nodes[one]?.name
    context.fillText(name ? shownName(name) : '', screenX(one), screenY(one) + radius + 3)
  }

  context.globalAlpha = 1
}

function fill(context: CanvasRenderingContext2D, path: Path2D, colour: string) {
  context.fillStyle = colour
  context.fill(path)
}

function brushed(
  context: CanvasRenderingContext2D,
  path: Path2D,
  brush: readonly (readonly [number, number])[],
  hair: number,
) {
  for (const [dx, dy] of brush) {
    if (!dx && !dy) {
      context.stroke(path)
      continue
    }

    context.save()
    context.translate(dx * hair, dy * hair)
    context.stroke(path)
    context.restore()
  }
}

function fillGroups(
  context: CanvasRenderingContext2D,
  paths: readonly (Path2D | undefined)[],
  colours: readonly string[],
) {
  for (let group = 0; group < paths.length; group++) {
    const path = paths[group]
    const colour = colours[group]
    if (path && colour) fill(context, path, colour)
  }
}

function head(path: Path2D, ax: number, ay: number, bx: number, by: number, radius: number): void {
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy)
  if (length < radius + HEAD_LONG) return

  const alongX = dx / length
  const alongY = dy / length
  const tipX = bx - alongX * radius
  const tipY = by - alongY * radius
  const backX = tipX - alongX * HEAD_LONG
  const backY = tipY - alongY * HEAD_LONG

  path.moveTo(tipX, tipY)
  path.lineTo(backX - alongY * HEAD_WIDE, backY + alongX * HEAD_WIDE)
  path.lineTo(backX + alongY * HEAD_WIDE, backY - alongX * HEAD_WIDE)
  path.closePath()
}

function outline(context: CanvasRenderingContext2D, path: Path2D, colour: string, hair: number) {
  context.strokeStyle = colour
  context.lineWidth = HAIRLINE * hair
  context.stroke(path)
}
