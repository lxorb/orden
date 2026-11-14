import {
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  freshId,
  type InkStroke,
  type Shape,
  type Side,
} from '@orden/markdown/canvas'
import {
  bounds,
  boxOf,
  type Box,
  containing,
  dragged,
  edgeBox,
  edgeEnds,
  gathered,
  GRID,
  type HandleId,
  isLineShape,
  keptAspect,
  overlaps,
  type Point,
  resizedBox,
  snapped,
} from './geometry'
import { erased, nearStroke, strokeBox, transformed } from './ink'

function replacing(canvas: Canvas, nodes: readonly CanvasNode[]): Canvas {
  if (!nodes.length) return canvas

  const byId = new Map(nodes.map((node) => [node.id, node]))
  return { ...canvas, nodes: canvas.nodes.map((node) => byId.get(node.id) ?? node) }
}

function nodeById(canvas: Canvas, id: string): CanvasNode | undefined {
  return canvas.nodes.find((node) => node.id === id)
}

export function reacher(canvas: Canvas): (picked: readonly string[]) => Set<string> {
  const groups = new Map<string, CanvasNode>()
  for (const node of canvas.nodes) if (node.type === 'group') groups.set(node.id, node)
  let cards: ((group: Box) => CanvasNode[]) | null = null
  let strokes: ((group: Box) => InkStroke[]) | null = null
  const inside = () =>
    (cards ??= containing(
      canvas.nodes.filter((node) => !node.locked),
      boxOf,
    ))

  return (picked) => {
    const going = new Set(picked)
    if (!groups.size) return going

    const chosen = [...going].flatMap((id) => {
      const group = groups.get(id)
      return group ? [group] : []
    })
    const reached = gathered(chosen, going, inside)
    if (!reached.length || !canvas.ink.length) return going

    strokes ??= containing(canvas.ink, strokeBox)
    for (const group of reached) {
      for (const stroke of strokes(boxOf(group))) going.add(stroke.id)
    }
    return going
  }
}

export function reach(canvas: Canvas, picked: readonly string[]): Set<string> {
  return reacher(canvas)(picked)
}

export function idSet(ids: readonly string[]): ReadonlySet<string> {
  return new Set(ids)
}

export function pickedBox(canvas: Canvas, picked: readonly string[]): Box | null {
  if (!picked.length) return null

  const wanted = new Set(picked)
  return bounds([
    ...canvas.nodes.filter((node) => wanted.has(node.id)),
    ...canvas.ink.filter((stroke) => wanted.has(stroke.id)).map(strokeBox),
  ])
}

export function planeBox(canvas: Canvas): Box | null {
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))
  const edges = canvas.edges.flatMap((edge) => {
    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
    return from && to ? [edgeBox(edgeEnds(edge, boxOf(from), boxOf(to)))] : []
  })

  return bounds([...canvas.nodes, ...canvas.ink.map(strokeBox), ...edges])
}

const INK_STEPS = 10

export function movedBy(canvas: Canvas, picked: readonly string[], dx: number, dy: number): Canvas {
  const moving = reach(canvas, picked)
  if (!moving.size || (!dx && !dy)) return canvas

  const whole = canvas.nodes.some((node) => moving.has(node.id))
  const step = whole ? 1 : INK_STEPS
  const across = Math.round(dx * step) / step
  const down = Math.round(dy * step) / step
  if (!across && !down) return canvas

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) =>
      moving.has(node.id) ? { ...node, x: node.x + across, y: node.y + down } : node,
    ),
    ink: canvas.ink.map((stroke) =>
      moving.has(stroke.id)
        ? transformed(stroke, {
            dx: across,
            dy: down,
            sx: 1,
            sy: 1,
            turn: 0,
            about: { x: 0, y: 0 },
          })
        : stroke,
    ),
  }
}

const LEAST = GRID * 2

export function resizedPick(
  canvas: Canvas,
  picked: readonly string[],
  handle: HandleId,
  dx: number,
  dy: number,
  aspect = false,
): Canvas {
  const was = pickedBox(canvas, picked)
  if (!was || was.width < 1 || was.height < 1) return canvas

  const pulled = resizedBox(was, handle, dx, dy, LEAST)
  const now = aspect ? keptAspect(was, pulled, handle, LEAST) : pulled
  const sx = now.width / was.width
  const sy = now.height / was.height
  if (sx === 1 && sy === 1 && now.x === was.x && now.y === was.y) return canvas

  const wanted = new Set(picked)

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => {
      if (!wanted.has(node.id)) return node

      return {
        ...node,
        x: Math.round(now.x + (node.x - was.x) * sx),
        y: Math.round(now.y + (node.y - was.y) * sy),
        width: Math.max(1, Math.round(node.width * sx)),
        height: Math.max(1, Math.round(node.height * sy)),
      }
    }),
    ink: canvas.ink.map((stroke) =>
      wanted.has(stroke.id)
        ? transformed(stroke, {
            dx: now.x - was.x * sx,
            dy: now.y - was.y * sy,
            sx,
            sy,
            turn: 0,
            about: { x: 0, y: 0 },
          })
        : stroke,
    ),
  }
}

export function turnedInk(
  canvas: Canvas,
  picked: readonly string[],
  turn: number,
  about: { x: number; y: number },
): Canvas {
  const wanted = new Set(picked)
  if (!turn) return canvas

  return {
    ...canvas,
    ink: canvas.ink.map((stroke) =>
      wanted.has(stroke.id)
        ? transformed(stroke, { dx: 0, dy: 0, sx: 1, sy: 1, turn, about })
        : stroke,
    ),
  }
}

export function withNode(canvas: Canvas, node: CanvasNode): Canvas {
  return { ...canvas, nodes: [...canvas.nodes, node] }
}

export function withGroup(canvas: Canvas, group: CanvasNode): Canvas {
  return { ...canvas, nodes: [group, ...canvas.nodes] }
}

export function withShape(
  canvas: Canvas,
  shape: Shape,
  from: { x: number; y: number },
  to: { x: number; y: number },
  colour?: string,
): { canvas: Canvas; id: string } {
  const id = freshId()
  const box = {
    x: Math.round(Math.min(from.x, to.x)),
    y: Math.round(Math.min(from.y, to.y)),
    width: Math.max(1, Math.round(Math.abs(to.x - from.x))),
    height: Math.max(1, Math.round(Math.abs(to.y - from.y))),
  }

  const node: CanvasNode = {
    id,
    type: 'shape',
    shape,
    ...box,
    ...(colour === undefined ? {} : { color: colour }),
    ...(isLineShape(shape) && (to.y - from.y) * (to.x - from.x) < 0 ? { up: true } : {}),
  }

  return { canvas: withNode(canvas, node), id }
}

const FRAME_ROOM = GRID * 2

export function grouped(canvas: Canvas, picked: readonly string[]): { canvas: Canvas; id: string } {
  const box = pickedBox(canvas, picked)
  if (!box) return { canvas, id: '' }

  const id = freshId()
  const group: CanvasNode = {
    id,
    type: 'group',
    x: Math.round(box.x - FRAME_ROOM),
    y: Math.round(box.y - FRAME_ROOM),
    width: Math.round(box.width + 2 * FRAME_ROOM),
    height: Math.round(box.height + 2 * FRAME_ROOM),
  }

  return { canvas: withGroup(canvas, group), id }
}

export function ungrouped(
  canvas: Canvas,
  picked: readonly string[],
): { canvas: Canvas; ids: string[] } {
  const wanted = new Set(picked)
  const going = canvas.nodes.filter((node) => node.type === 'group' && wanted.has(node.id))
  if (!going.length) return { canvas, ids: [] }

  const gone = new Set(going.map((group) => group.id))
  const held = new Set<string>()
  for (const group of going) {
    for (const id of dragged(canvas, [group.id])) {
      if (!gone.has(id)) held.add(id)
    }
  }

  return {
    canvas: {
      ...canvas,
      nodes: canvas.nodes.filter((node) => !gone.has(node.id)),
      edges: canvas.edges.filter((edge) => !gone.has(edge.fromNode) && !gone.has(edge.toNode)),
    },
    ids: [...held],
  }
}

export function reattached(canvas: Canvas, id: string, end: 'from' | 'to', node: string): Canvas {
  const edge = canvas.edges.find((one) => one.id === id)
  if (!edge || !nodeById(canvas, node)) return canvas
  if ((end === 'from' ? edge.toNode : edge.fromNode) === node) return canvas
  if ((end === 'from' ? edge.fromNode : edge.toNode) === node) return canvas

  const moved: CanvasEdge = { ...edge, ...(end === 'from' ? { fromNode: node } : { toNode: node }) }
  const sideless = put(moved, end === 'from' ? 'fromSide' : 'toSide', null)

  return { ...canvas, edges: canvas.edges.map((one) => (one.id === id ? sideless : one)) }
}

export function withStroke(canvas: Canvas, stroke: InkStroke): Canvas {
  return { ...canvas, ink: [...canvas.ink, stroke] }
}

function cutInk(canvas: Canvas, cut: (stroke: InkStroke) => InkStroke[]): Canvas {
  let changed = false
  const ink: InkStroke[] = []

  for (const stroke of canvas.ink) {
    const pieces = cut(stroke)
    if (pieces.length === 1 && pieces[0] === stroke) {
      ink.push(stroke)
      continue
    }

    changed = true
    ink.push(...pieces)
  }

  return changed ? { ...canvas, ink } : canvas
}

export function rubbedOut(
  canvas: Canvas,
  ats: readonly Point[],
  reach: number,
  whole: boolean,
): Canvas {
  const way = bounds(ats.map((at) => ({ ...at, width: 0, height: 0 })))
  if (!way) return canvas

  return cutInk(canvas, (stroke) => {
    const box = strokeBox(stroke)
    const room = reach + stroke.size / 2 + 1
    const near = {
      x: way.x - room,
      y: way.y - room,
      width: way.width + room * 2,
      height: way.height + room * 2,
    }
    if (!overlaps(box, near)) return [stroke]

    let pieces: InkStroke[] = [stroke]
    for (const at of ats) {
      if (!pieces.length) break
      pieces = pieces.flatMap((piece) =>
        !nearStroke(piece, at, reach) ? [piece] : whole ? [] : erased(piece, at, reach),
      )
    }
    return pieces
  })
}

export function withText(canvas: Canvas, id: string, text: string): Canvas {
  const node = nodeById(canvas, id)
  if (!node) return canvas

  if (node.type === 'shape') {
    if ((node.text ?? '') === text) return canvas
    return replacing(canvas, [put(node, 'text', text.trim() ? text : null)])
  }

  if (node.type !== 'text' || node.text === text) return canvas

  return replacing(canvas, [{ ...node, text }])
}

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

export function withEnds(
  canvas: Canvas,
  picked: readonly string[],
  from: boolean,
  to: boolean,
): Canvas {
  const chosen = new Set(picked)

  return {
    ...canvas,
    edges: canvas.edges.map((edge) => {
      if (!chosen.has(edge.id)) return edge

      const one = put(edge, 'fromEnd', from ? 'arrow' : null)
      return put(one, 'toEnd', to ? null : 'none')
    }),
  }
}

export function coloured(canvas: Canvas, picked: readonly string[], colour: string | null): Canvas {
  const chosen = new Set(picked)

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => (chosen.has(node.id) ? put(node, 'color', colour) : node)),
    edges: canvas.edges.map((edge) => (chosen.has(edge.id) ? put(edge, 'color', colour) : edge)),
    ink: colour
      ? canvas.ink.map((stroke) => (chosen.has(stroke.id) ? { ...stroke, color: colour } : stroke))
      : canvas.ink,
  }
}

export function locking(canvas: Canvas, ids: readonly string[], locked: boolean): Canvas {
  const chosen = new Set(ids)

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) =>
      chosen.has(node.id) && !node.locked === locked ? put(node, 'locked', locked || null) : node,
    ),
  }
}

export function sized(canvas: Canvas, picked: readonly string[], size: number): Canvas {
  const chosen = new Set(picked)

  return {
    ...canvas,
    ink: canvas.ink.map((stroke) => (chosen.has(stroke.id) ? { ...stroke, size } : stroke)),
  }
}

function put<T extends object, K extends keyof T & string>(one: T, key: K, value: T[K] | null): T {
  const rest = Object.fromEntries(Object.entries(one).filter(([name]) => name !== key))
  return { ...rest, ...(value === null ? {} : { [key]: value }) } as T
}

export function removed(canvas: Canvas, picked: readonly string[]): Canvas {
  const going = reach(canvas, picked)
  if (!going.size) return canvas

  return {
    ...canvas,
    nodes: canvas.nodes.filter((node) => !going.has(node.id)),
    edges: canvas.edges.filter(
      (edge) => !going.has(edge.fromNode) && !going.has(edge.toNode) && !going.has(edge.id),
    ),
    ink: canvas.ink.filter((stroke) => !going.has(stroke.id)),
  }
}

export function connected(
  canvas: Canvas,
  fromNode: string,
  fromSide: Side,
  toNode: string,
  toSide: Side,
  head = true,
): { canvas: Canvas; id: string | null } {
  if (fromNode === toNode) return { canvas, id: null }
  if (!nodeById(canvas, fromNode) || !nodeById(canvas, toNode)) return { canvas, id: null }

  const already = canvas.edges.find(
    (edge) =>
      edge.fromNode === fromNode &&
      edge.toNode === toNode &&
      edge.fromSide === fromSide &&
      edge.toSide === toSide,
  )
  if (already) return { canvas, id: already.id }

  const edge: CanvasEdge = {
    id: freshId(),
    fromNode,
    fromSide,
    toNode,
    toSide,
    ...(head ? {} : { toEnd: 'none' as const }),
  }
  return { canvas: { ...canvas, edges: [...canvas.edges, edge] }, id: edge.id }
}

const COPY_OFFSET = GRID

export function subset(canvas: Canvas, picked: readonly string[]): Canvas {
  const taking = reach(canvas, picked)

  return {
    nodes: canvas.nodes.filter((node) => taking.has(node.id)),
    edges: canvas.edges.filter((edge) => taking.has(edge.fromNode) && taking.has(edge.toNode)),
    ink: canvas.ink.filter((stroke) => taking.has(stroke.id)),
    at: {},
    gone: {},
  }
}

export function pasted(
  canvas: Canvas,
  incoming: Canvas,
  dx = 0,
  dy = 0,
): { canvas: Canvas; ids: string[] } {
  if (!incoming.nodes.length && !incoming.ink.length) return { canvas, ids: [] }

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

  const ink = incoming.ink.map((stroke) => ({
    ...transformed(stroke, { dx, dy, sx: 1, sy: 1, turn: 0, about: { x: 0, y: 0 } }),
    id: freshId(),
  }))

  return {
    canvas: {
      ...canvas,
      nodes: [...canvas.nodes, ...nodes],
      edges: [...canvas.edges, ...edges],
      ink: [...canvas.ink, ...ink],
    },
    ids: [...nodes.map((node) => node.id), ...ink.map((stroke) => stroke.id)],
  }
}

export function copied(
  canvas: Canvas,
  picked: readonly string[],
  dx = COPY_OFFSET,
  dy = COPY_OFFSET,
): { canvas: Canvas; ids: string[] } {
  return pasted(canvas, subset(canvas, picked), dx, dy)
}

export function placedAt(at: { x: number; y: number }, width: number, height: number): Box {
  return {
    x: snapped(at.x - width / 2),
    y: snapped(at.y - height / 2),
    width,
    height,
  }
}
