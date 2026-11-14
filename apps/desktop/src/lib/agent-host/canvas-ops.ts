import {
  type Canvas,
  type CanvasNode,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  freshId,
  type Side,
} from '../canvas/format'
import { connected, movedBy, removed, withLabel, withNode, withText } from '../canvas/edits'
import { FURTHEST } from '@orden/markdown/canvas'
import { settled } from '@orden/markdown/pages'
import { hasPages, pageIn, pageOperation, placeOnPage } from './pages-ops'
import { Refused } from './problem'

export function readable(canvas: Canvas) {
  return { nodes: canvas.nodes, edges: canvas.edges, ink: canvas.ink.length }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOf(op: Record<string, unknown>, key: string): number | null {
  const value = op[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textOf(op: Record<string, unknown>, key: string): string | null {
  const value = op[key]
  return typeof value === 'string' ? value : null
}

const MOST_OPS = 500
const LARGEST = 100_000

function held(value: number): number {
  return Math.round(Math.min(FURTHEST, Math.max(-FURTHEST, value)))
}

function sized(op: Record<string, unknown>, key: string, fallback: number): number {
  return Math.min(LARGEST, Math.max(20, Math.round(numberOf(op, key) ?? fallback)))
}

function nodeIn(canvas: Canvas, id: string | null): CanvasNode {
  const found = id === null ? undefined : canvas.nodes.find((node) => node.id === id)
  if (!found) throw new Refused('not_found', `there is no card ${String(id)} on the canvas`)

  return found
}

function freePlace(canvas: Canvas): { x: number; y: number } {
  if (!canvas.nodes.length) return { x: 0, y: 0 }

  const left = canvas.nodes.map((node) => node.x).reduce((low, one) => Math.min(low, one), Infinity)
  const bottom = canvas.nodes
    .map((node) => node.y + node.height)
    .reduce((high, one) => Math.max(high, one), -Infinity)
  return { x: left, y: bottom + DEFAULT_HEIGHT }
}

function sidesBetween(from: CanvasNode, to: CanvasNode): [Side, Side] {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)

  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

function pageNamed(canvas: Canvas, op: Record<string, unknown>) {
  if (op.page === undefined) return null
  if (!hasPages(canvas)) throw new Refused('bad_arguments', 'a canvas has no pages')

  return pageIn(canvas, op.page)
}

const OPS =
  'add_card, edit_text, move, connect, remove, and in a page note add_page, remove_page, move_page'

export function applied(canvas: Canvas, ops: unknown): { canvas: Canvas; made: string[] } {
  if (!Array.isArray(ops) || !ops.length) {
    throw new Refused('bad_arguments', 'ops is a list of at least one operation')
  }
  if (ops.length > MOST_OPS) throw new Refused('bad_arguments', `at most ${MOST_OPS} ops a call`)

  let now = settled(canvas)
  const made: string[] = []

  for (const op of ops) {
    if (!isRecord(op)) throw new Refused('bad_arguments', 'an operation is an object')
    const id = textOf(op, 'id')

    switch (op.op) {
      case 'add_card': {
        const page = pageNamed(now, op)
        const at = page
          ? placeOnPage(now, page, numberOf(op, 'x'), numberOf(op, 'y'))
          : freePlace(now)
        const colour = textOf(op, 'color') ?? textOf(op, 'colour')
        const card: CanvasNode = {
          id: freshId(),
          type: 'text',
          text: textOf(op, 'text') ?? '',
          x: held(page ? at.x : (numberOf(op, 'x') ?? at.x)),
          y: held(page ? at.y : (numberOf(op, 'y') ?? at.y)),
          width: sized(op, 'width', DEFAULT_WIDTH),
          height: sized(op, 'height', DEFAULT_HEIGHT),
          ...(colour ? { color: colour } : {}),
        }
        now = withNode(now, card)
        made.push(card.id)
        break
      }

      case 'edit_text': {
        const words = textOf(op, 'text')
        if (words === null) throw new Refused('bad_arguments', 'edit_text says text')

        const edge = now.edges.find((one) => one.id === id)
        if (edge) {
          now = withLabel(now, edge.id, words)
          break
        }

        const node = nodeIn(now, id)
        now = node.type === 'group' ? withLabel(now, node.id, words) : withText(now, node.id, words)
        break
      }

      case 'move': {
        const node = nodeIn(now, id)
        const page = pageNamed(now, op)
        const corner = page
          ? placeOnPage(now, page, numberOf(op, 'x') ?? 0, numberOf(op, 'y') ?? 0)
          : null
        const x = corner ? corner.x : numberOf(op, 'x')
        const y = corner ? corner.y : numberOf(op, 'y')
        const dx = held(x ?? node.x + (numberOf(op, 'dx') ?? 0)) - node.x
        const dy = held(y ?? node.y + (numberOf(op, 'dy') ?? 0)) - node.y
        now = movedBy(now, [node.id], dx, dy)
        break
      }

      case 'connect': {
        const from = nodeIn(now, textOf(op, 'from'))
        const to = nodeIn(now, textOf(op, 'to'))
        const [fromSide, toSide] = sidesBetween(from, to)
        const joined = connected(now, from.id, fromSide, to.id, toSide)
        if (joined.id === null)
          throw new Refused('bad_arguments', 'a card cannot connect to itself')

        now = joined.canvas
        const label = textOf(op, 'label') ?? textOf(op, 'text')
        if (label) now = withLabel(now, joined.id, label)
        made.push(joined.id)
        break
      }

      case 'remove': {
        const there = [...now.nodes, ...now.edges, ...now.ink].some((one) => one.id === id)
        if (id === null || !there)
          throw new Refused('not_found', `there is no ${String(id)} on the canvas`)

        const page = now.nodes.find((node) => node.id === id)?.type === 'page'
        now = page
          ? (pageOperation(now, { op: 'remove_page', id })?.canvas ?? now)
          : removed(now, [id])
        break
      }

      default: {
        const paged = hasPages(now) ? pageOperation(now, op) : null
        if (!paged) throw new Refused('bad_arguments', `op is one of ${OPS}`)

        now = paged.canvas
        if (paged.made) made.push(paged.made)
      }
    }
  }

  return { canvas: now, made }
}
