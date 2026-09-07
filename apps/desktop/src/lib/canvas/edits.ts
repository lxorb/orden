/** Everything that can be done to a canvas, as pure functions from one canvas to
 *  the next.
 *
 *  Nothing here changes a node in place. An edit hands back a new canvas whose
 *  untouched nodes are the very same objects, which is what makes the undo stack
 *  next door cheap and what lets the surface tell in one comparison whether a
 *  node it is drawing has moved. */

import { type Canvas, type CanvasEdge, type CanvasNode, freshId, type Side } from './format'
import { boxOf, type Box, dragged, GRID, type HandleId, resized, snapped } from './geometry'

/** The canvas with some of its nodes replaced, keeping the order they were in:
 *  the order is the z order, and an edit must never bring a card to the front by
 *  accident. */
function replacing(canvas: Canvas, nodes: readonly CanvasNode[]): Canvas {
  if (!nodes.length) return canvas

  const byId = new Map(nodes.map((node) => [node.id, node]))
  return { ...canvas, nodes: canvas.nodes.map((node) => byId.get(node.id) ?? node) }
}

function nodeById(canvas: Canvas, id: string): CanvasNode | undefined {
  return canvas.nodes.find((node) => node.id === id)
}

/** Nodes moved by a whole number of pixels, with each landing on the grid.
 *
 *  The offset is snapped rather than each node's own corner, so a selection of
 *  several keeps its shape: snapping every node on its own would pull a row of
 *  cards into a single column the moment it was nudged.
 *
 *  A group among them carries whatever sits inside it; see `dragged`. */
export function movedBy(canvas: Canvas, picked: readonly string[], dx: number, dy: number): Canvas {
  const moving = new Set(dragged(canvas, picked))
  if (!moving.size) return canvas

  const across = snapped(dx)
  const down = snapped(dy)

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) =>
      moving.has(node.id) ? { ...node, x: node.x + across, y: node.y + down } : node,
    ),
  }
}

/** One node after a resize handle has been dragged. */
export function resizedNode(
  canvas: Canvas,
  id: string,
  handle: HandleId,
  dx: number,
  dy: number,
): Canvas {
  const node = nodeById(canvas, id)
  if (!node) return canvas

  return replacing(canvas, [{ ...node, ...resized(boxOf(node), handle, dx, dy) }])
}

/** A node put on top of the canvas, which is where a new one belongs: the order
 *  of the list is the z order. */
export function withNode(canvas: Canvas, node: CanvasNode): Canvas {
  return { ...canvas, nodes: [...canvas.nodes, node] }
}

/** A group behind everything, which is where a frame belongs: drawn over its own
 *  contents it would hide them. */
export function withGroup(canvas: Canvas, group: CanvasNode): Canvas {
  return { ...canvas, nodes: [group, ...canvas.nodes] }
}

export function withText(canvas: Canvas, id: string, text: string): Canvas {
  const node = nodeById(canvas, id)
  if (node?.type !== 'text' || node.text === text) return canvas

  return replacing(canvas, [{ ...node, text }])
}

/** The words on a group's frame, or along an edge. An empty label is taken away
 *  rather than written: the field is optional in the format, and a frame wearing
 *  `""` is one with a label nobody can see. */
export function withLabel(canvas: Canvas, id: string, label: string): Canvas {
  const node = nodeById(canvas, id)
  if (node?.type === 'group') return replacing(canvas, [put(node, 'label', label.trim() || null)])

  return {
    ...canvas,
    edges: canvas.edges.map((edge) =>
      edge.id === id ? put(edge, 'label', label.trim() || null) : edge,
    ),
  }
}

/** Nodes and edges given a colour, or stripped of one. Both kinds at once,
 *  because the colour dots act on whatever is picked, and a canvas colours its
 *  cards and its connectors the same way. */
export function coloured(canvas: Canvas, picked: readonly string[], colour: string | null): Canvas {
  const chosen = new Set(picked)

  return {
    nodes: canvas.nodes.map((node) => (chosen.has(node.id) ? put(node, 'color', colour) : node)),
    edges: canvas.edges.map((edge) => (chosen.has(edge.id) ? put(edge, 'color', colour) : edge)),
  }
}

/** One optional field set, or dropped for null.
 *
 *  Dropped rather than set to undefined, because what goes into the file is only
 *  what the spec defines: `"color": undefined` would come out as a key that is
 *  not in the spec, or vanish silently depending on the serialiser, and neither
 *  is a decision worth leaving to chance.
 *
 *  The cast is what a generic spread costs: the compiler cannot see that an
 *  object missing one optional field, plus that field, is the object again. */
function put<T extends object, K extends keyof T & string>(one: T, key: K, value: T[K] | null): T {
  const rest = Object.fromEntries(Object.entries(one).filter(([name]) => name !== key))
  return { ...rest, ...(value === null ? {} : { [key]: value }) } as T
}

/** Nodes and edges gone. A node takes every edge that touched it: an edge from
 *  nothing to nothing is not a connector, and the format has no place to put one.
 *  A group takes its contents with it, the way a drag does. */
export function removed(canvas: Canvas, picked: readonly string[]): Canvas {
  const going = new Set(dragged(canvas, picked))
  if (!going.size) return canvas

  return {
    nodes: canvas.nodes.filter((node) => !going.has(node.id)),
    edges: canvas.edges.filter(
      (edge) => !going.has(edge.fromNode) && !going.has(edge.toNode) && !going.has(edge.id),
    ),
  }
}

/** An edge between two nodes, from one side to another. A second edge the same
 *  way round between the same two sides is not added: a pair of nodes joined
 *  twice reads as one thicker line and there is nothing to be done with the
 *  second. */
export function connected(
  canvas: Canvas,
  fromNode: string,
  fromSide: Side,
  toNode: string,
  toSide: Side,
): Canvas {
  if (fromNode === toNode) return canvas
  if (!nodeById(canvas, fromNode) || !nodeById(canvas, toNode)) return canvas

  const already = canvas.edges.some(
    (edge) =>
      edge.fromNode === fromNode &&
      edge.toNode === toNode &&
      edge.fromSide === fromSide &&
      edge.toSide === toSide,
  )
  if (already) return canvas

  const edge: CanvasEdge = { id: freshId(), fromNode, fromSide, toNode, toSide }
  return { ...canvas, edges: [...canvas.edges, edge] }
}

/** How far a copy lands from what it was copied from: one grid step each way, so
 *  the copy is visibly its own card and still where the hand left off. */
const COPY_OFFSET = GRID

/** The picked cards as a canvas of their own, with the edges that ran between
 *  them and nothing else. What a copy puts on the clipboard, so what is pasted
 *  from it is a canvas any app that reads the format can take. */
export function subset(canvas: Canvas, picked: readonly string[]): Canvas {
  const taking = new Set(dragged(canvas, picked))

  return {
    nodes: canvas.nodes.filter((node) => taking.has(node.id)),
    edges: canvas.edges.filter((edge) => taking.has(edge.fromNode) && taking.has(edge.toNode)),
  }
}

/** Cards from somewhere else onto this canvas, moved by an offset and renamed as
 *  they arrive: an id belongs to the file it is in, and two cards sharing one
 *  would leave every edge pointing at whichever came first.
 *
 *  Answers the canvas and the ids of what arrived, so the caller can pick what it
 *  just made: pasting something and then having to find it is the one thing a
 *  paste should never make anybody do. */
export function pasted(
  canvas: Canvas,
  incoming: Canvas,
  dx = 0,
  dy = 0,
): { canvas: Canvas; ids: string[] } {
  if (!incoming.nodes.length) return { canvas, ids: [] }

  const renamed = new Map(incoming.nodes.map((node) => [node.id, freshId()]))
  const nodes: CanvasNode[] = incoming.nodes.map((node) => ({
    ...node,
    id: renamed.get(node.id) ?? node.id,
    x: node.x + dx,
    y: node.y + dy,
  }))

  const edges = incoming.edges
    .filter((edge) => renamed.has(edge.fromNode) && renamed.has(edge.toNode))
    .map((edge) => ({
      ...edge,
      id: freshId(),
      fromNode: renamed.get(edge.fromNode) ?? edge.fromNode,
      toNode: renamed.get(edge.toNode) ?? edge.toNode,
    }))

  return {
    canvas: { nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...edges] },
    ids: nodes.map((node) => node.id),
  }
}

/** Copies of what is picked, a grid step along from the originals. */
export function copied(
  canvas: Canvas,
  picked: readonly string[],
  dx = COPY_OFFSET,
  dy = COPY_OFFSET,
): { canvas: Canvas; ids: string[] } {
  return pasted(canvas, subset(canvas, picked), dx, dy)
}

/** A card dropped somewhere on the plane, sized as it should start and with its
 *  top left on the grid. `at` is where the pointer was, and the card is centred
 *  on it: a card that appeared beside the click would read as a miss. */
export function placedAt(at: { x: number; y: number }, width: number, height: number): Box {
  return {
    x: snapped(at.x - width / 2),
    y: snapped(at.y - height / 2),
    width,
    height,
  }
}
