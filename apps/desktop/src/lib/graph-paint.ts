/** The graph, drawn.
 *
 *  Canvas rather than elements: a space of thousands of notes is thousands of
 *  circles and twice as many lines, and that many DOM nodes cannot be panned at
 *  sixty frames a second.
 *
 *  Everything of one colour is collected into one path and filled once, which is
 *  what keeps the whole picture to a handful of drawing calls however many notes
 *  are in it: six for the nodes, two for the lines. Colours come in from the
 *  stylesheet, so the graph is whatever the theme says it is. */

import type { Camera } from './graph-camera'
import { SMALLEST_DOT } from './graph-camera'
import type { NoteGraph } from './graph'

/** How wide a note is drawn, in graph units, by how many links it has. The square
 *  root, so a note with a hundred links is noticeably bigger than one with four
 *  and not twenty five times bigger, and a ceiling on top of that: past a few
 *  dozen links the only thing a bigger circle says is that it covers the notes
 *  behind it. */
export function radiusOf(degree: number): number {
  return 3 + Math.min(7, Math.sqrt(degree))
}

/** How faint everything that is not being pointed at goes. */
const DIMMED = 0.16

/** How close the view has to be before the names appear. Below this a label
 *  would be smaller than the gaps between the notes. */
const LABELS_FROM = 0.55

/** How many names are worth drawing at once. Past this the view is showing more
 *  notes than anyone reads at a glance, and the text is what costs. */
const MOST_LABELS = 400

const LABEL_SIZE = 11
const EDGE_WIDTH = 1
const LIT_EDGE_WIDTH = 1.6

/** The colours the graph is drawn in, all of them from the tokens. No ground
 *  among them: the canvas is left transparent and the surface it sits on shows
 *  through, so the graph is on the same ground as whatever is around it. */
export interface GraphColours {
  edge: string
  litEdge: string
  node: string
  hollow: string
  current: string
  label: string
  font: string
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
  /** Which node is the note being read, or -1. */
  current: number
  /** Which node the pointer is on, or -1. Everything not touching it is faint. */
  hovered: number
  /** One byte per node: 2 for the hovered node, 1 for one joined to it, 0 for
   *  the rest, which go faint. Read only while something is hovered. */
  lit: Uint8Array
}

/** One pass over the graph, into as few drawing calls as it takes. */
export function paint(context: CanvasRenderingContext2D, view: GraphView) {
  const { graph, x, y, radii, camera, width, height, colours, current, hovered, lit } = view
  const highlighting = hovered >= 0

  const scale = camera.scale
  const offsetX = width / 2 - camera.x * scale
  const offsetY = height / 2 - camera.y * scale
  const screenX = (one: number) => (x[one] ?? 0) * scale + offsetX
  const screenY = (one: number) => (y[one] ?? 0) * scale + offsetY

  // A margin the width of the largest node, so one whose centre is just off
  // screen still draws the sliver of it that shows.
  const margin = 40

  const edges = new Path2D()
  const litEdges = new Path2D()

  for (const edge of graph.edges) {
    const ax = screenX(edge.a)
    const ay = screenY(edge.a)
    const bx = screenX(edge.b)
    const by = screenY(edge.b)

    if (Math.max(ax, bx) < -margin || Math.min(ax, bx) > width + margin) continue
    if (Math.max(ay, by) < -margin || Math.min(ay, by) > height + margin) continue

    const path = highlighting && (lit[edge.a] === 2 || lit[edge.b] === 2) ? litEdges : edges
    path.moveTo(ax, ay)
    path.lineTo(bx, by)
  }

  context.lineWidth = EDGE_WIDTH
  context.strokeStyle = colours.edge
  context.globalAlpha = highlighting ? DIMMED : 1
  context.stroke(edges)

  if (highlighting) {
    context.lineWidth = LIT_EDGE_WIDTH
    context.strokeStyle = colours.litEdge
    context.globalAlpha = 1
    context.stroke(litEdges)
  }

  // Six paths: the three kinds of node, each faint or not.
  const plain = new Path2D()
  const litPlain = new Path2D()
  const hollow = new Path2D()
  const litHollow = new Path2D()
  const here = new Path2D()
  const litHere = new Path2D()
  /** Which nodes are on screen and close enough to name, gathered on the way
   *  past so the labels do not walk the whole graph again. */
  const naming: number[] = []
  const labelling = scale >= LABELS_FROM

  for (let one = 0; one < graph.nodes.length; one++) {
    const px = screenX(one)
    const py = screenY(one)
    if (px < -margin || px > width + margin || py < -margin || py > height + margin) continue

    const radius = Math.max(SMALLEST_DOT, (radii[one] ?? 0) * scale)
    // With nothing hovered there is nothing to bring forward: the whole picture
    // is drawn plainly, at full strength.
    const brought = highlighting && lit[one] !== 0

    const path =
      one === current
        ? brought
          ? litHere
          : here
        : graph.nodes[one]?.path === null
          ? brought
            ? litHollow
            : hollow
          : brought
            ? litPlain
            : plain

    path.moveTo(px + radius, py)
    path.arc(px, py, radius, 0, Math.PI * 2)

    if (labelling && naming.length < MOST_LABELS) naming.push(one)
  }

  context.globalAlpha = highlighting ? DIMMED : 1
  fill(context, plain, colours.node)
  fill(context, here, colours.current)
  outline(context, hollow, colours.hollow)

  if (highlighting) {
    context.globalAlpha = 1
    fill(context, litPlain, colours.node)
    fill(context, litHere, colours.current)
    outline(context, litHollow, colours.hollow)
  }

  // The note being read wears a ring as well as the accent, so it is the one
  // node that can be picked out without hovering anything.
  if (current >= 0) {
    const px = screenX(current)
    const py = screenY(current)
    const radius = Math.max(SMALLEST_DOT, (radii[current] ?? 0) * scale)

    context.globalAlpha = highlighting && lit[current] === 0 ? DIMMED : 1
    context.strokeStyle = colours.current
    context.lineWidth = 1.2
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

  for (const one of naming) {
    context.globalAlpha = highlighting && lit[one] === 0 ? DIMMED : 1
    const radius = Math.max(SMALLEST_DOT, (radii[one] ?? 0) * scale)
    context.fillText(graph.nodes[one]?.name ?? '', screenX(one), screenY(one) + radius + 3)
  }

  context.globalAlpha = 1
}

function fill(context: CanvasRenderingContext2D, path: Path2D, colour: string) {
  context.fillStyle = colour
  context.fill(path)
}

/** A note the space does not hold is a ring rather than a dot, the same "there is
 *  nothing here yet" the dotted link in the text says. */
function outline(context: CanvasRenderingContext2D, path: Path2D, colour: string) {
  context.strokeStyle = colour
  context.lineWidth = 1
  context.stroke(path)
}
