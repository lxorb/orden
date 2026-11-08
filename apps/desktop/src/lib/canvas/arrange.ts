import type { Canvas, CanvasNode } from './format'
import { reacher } from './edits'
import { bounds, type Box, boxOf } from './geometry'
import { transformed } from './ink'

export const ALIGNMENTS = ['left', 'centre', 'right', 'top', 'middle', 'bottom'] as const
export type Alignment = (typeof ALIGNMENTS)[number]

function placed(box: Box, how: Alignment, span: Box): { x: number; y: number } {
  switch (how) {
    case 'left':
      return { x: span.x, y: box.y }
    case 'centre':
      return { x: span.x + span.width / 2 - box.width / 2, y: box.y }
    case 'right':
      return { x: span.x + span.width - box.width, y: box.y }
    case 'top':
      return { x: box.x, y: span.y }
    case 'middle':
      return { x: box.x, y: span.y + span.height / 2 - box.height / 2 }
    case 'bottom':
      return { x: box.x, y: span.y + span.height - box.height }
  }
}

function chosen(canvas: Canvas, picked: readonly string[]): CanvasNode[] {
  const wanted = new Set(picked)
  return canvas.nodes.filter((node) => wanted.has(node.id))
}

function shifted(canvas: Canvas, moves: ReadonlyMap<string, { dx: number; dy: number }>): Canvas {
  const byId = new Map<string, { dx: number; dy: number }>()
  const nodes = new Map(canvas.nodes.map((one) => [one.id, one]))
  const reach = reacher(canvas)

  for (const [id, move] of moves) {
    if (!move.dx && !move.dy) continue
    const node = nodes.get(id)
    const whole = node
      ? { dx: Math.round(node.x + move.dx) - node.x, dy: Math.round(node.y + move.dy) - node.y }
      : move
    for (const carried of reach([id])) {
      if (!byId.has(carried)) byId.set(carried, whole)
    }
  }

  if (!byId.size) return canvas

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => {
      const move = byId.get(node.id)
      return move
        ? { ...node, x: Math.round(node.x + move.dx), y: Math.round(node.y + move.dy) }
        : node
    }),
    ink: canvas.ink.map((stroke) => {
      const move = byId.get(stroke.id)
      return move
        ? transformed(stroke, { ...move, sx: 1, sy: 1, turn: 0, about: { x: 0, y: 0 } })
        : stroke
    }),
  }
}

export function aligned(canvas: Canvas, picked: readonly string[], how: Alignment): Canvas {
  const nodes = chosen(canvas, picked)
  if (nodes.length < 2) return canvas

  const span = bounds(nodes)
  if (!span) return canvas

  const moves = new Map<string, { dx: number; dy: number }>()
  for (const node of nodes) {
    const to = placed(boxOf(node), how, span)
    moves.set(node.id, { dx: to.x - node.x, dy: to.y - node.y })
  }

  return shifted(canvas, moves)
}

export function distributed(canvas: Canvas, picked: readonly string[], axis: 'x' | 'y'): Canvas {
  const nodes = chosen(canvas, picked)
  if (nodes.length < 3) return canvas

  const along = axis === 'x' ? (node: CanvasNode) => node.x : (node: CanvasNode) => node.y
  const size = axis === 'x' ? (node: CanvasNode) => node.width : (node: CanvasNode) => node.height

  const order = [...nodes].sort((one, other) => along(one) - along(other))
  const first = order[0]
  const last = order[order.length - 1]
  if (!first || !last) return canvas

  const room =
    along(last) - along(first) - order.slice(0, -1).reduce((sum, one) => sum + size(one), 0)
  const gap = room / (order.length - 1)

  const moves = new Map<string, { dx: number; dy: number }>()
  let at = along(first)

  for (const node of order) {
    const to = Math.round(at)
    moves.set(node.id, axis === 'x' ? { dx: to - node.x, dy: 0 } : { dx: 0, dy: to - node.y })
    at += size(node) + gap
  }

  return shifted(canvas, moves)
}

export type Order = 'front' | 'forward' | 'backward' | 'back'

export function ordered(canvas: Canvas, picked: readonly string[], how: Order): Canvas {
  const wanted = new Set(picked)
  const nodes = canvas.nodes
  if (!wanted.size || nodes.every((node) => wanted.has(node.id))) return canvas

  if (how === 'front' || how === 'back') {
    const moving = nodes.filter((node) => wanted.has(node.id))
    const still = nodes.filter((node) => !wanted.has(node.id))
    if (!moving.length) return canvas

    return { ...canvas, nodes: how === 'front' ? [...still, ...moving] : [...moving, ...still] }
  }

  const next = [...nodes]
  const by = how === 'forward' ? 1 : -1
  const walk = how === 'forward' ? [...next.keys()].reverse() : [...next.keys()]

  for (const index of walk) {
    const node = next[index]
    if (!node || !wanted.has(node.id)) continue

    const to = index + by
    const other = next[to]
    if (!other || wanted.has(other.id)) continue

    next[index] = other
    next[to] = node
  }

  return { ...canvas, nodes: next }
}
