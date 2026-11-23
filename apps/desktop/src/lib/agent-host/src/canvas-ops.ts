import {
  type Canvas,
  type CanvasNode,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  freshId,
  FURTHEST,
  type Side,
  textSized,
} from '@orden/markdown/canvas'
import { connected, movedBy, removed, withLabel, withNode, withText } from '../../plane/src/api'
import { settled } from '@orden/markdown/pages'
import { hasPages, pageIn, pageOperation, placeOnPage } from './pages-ops'
import { Refused } from '../../agent-verbs/src/api'
import { isRecord } from '../../platform/src/api'
import { shown } from './shown-node'

export function readable(canvas: Canvas) {
  return { nodes: canvas.nodes.map(shown), edges: canvas.edges, ink: canvas.ink.length }
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
  const bottom = canvas.nodes.map((node) => node.y + node.height).reduce((high, one) => Math.max(high, one), -Infinity)
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
function flag(op: Record<string, unknown>, key: string): boolean | null {
  const value = op[key]
  return typeof value === 'boolean' ? value : null
}
function fontSizeOf(op: Record<string, unknown>): number | null | undefined {
  if (op.fontSize === null) return null
  if (op.fontSize === undefined) return undefined
  const size = textSized(op.fontSize)
  if (size === undefined) throw new Refused('bad_arguments', 'fontSize is a number above 0')
  return size
}
type TextCard = CanvasNode & { type: 'text' }
function styled(card: TextCard, op: Record<string, unknown>): TextCard {
  const { bare, size, fit, color, ...rest } = card
  const wantBare = flag(op, 'bare') ?? bare === true
  const wantFit = flag(op, 'fit') ?? fit === true
  const wantSize = fontSizeOf(op)
  const nextSize = wantSize === undefined ? size : (wantSize ?? undefined)
  const said = op.color === undefined ? op.colour : op.color
  if (said !== undefined && said !== null && typeof said !== 'string') {
    throw new Refused('bad_arguments', 'color is a preset 1 to 6 or a hex colour')
  }
  const nextColour = said === undefined ? color : said === null || said === '' ? undefined : said
  return {
    ...rest,
    ...(nextColour === undefined ? {} : { color: nextColour }),
    ...(wantBare ? { bare: true } : {}),
    ...(nextSize === undefined ? {} : { size: nextSize }),
    ...(wantFit ? { fit: true } : {}),
  }
}
function replaced(canvas: Canvas, card: CanvasNode): Canvas {
  return { ...canvas, nodes: canvas.nodes.map((node) => (node.id === card.id ? card : node)) }
}
const LEADING = 1.55
const OPS = 'add_card, edit_text, style, move, connect, remove, and in a page note add_page, remove_page, move_page'
export function applied(
  canvas: Canvas,
  ops: unknown,
  pageSizes: ReadonlyMap<string, number> = new Map(),
): { canvas: Canvas; made: string[] } {
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
        const at = page ? placeOnPage(now, page, numberOf(op, 'x'), numberOf(op, 'y')) : freePlace(now)
        const colour = textOf(op, 'color') ?? textOf(op, 'colour')
        const printed = page ? pageSizes.get(page.id) : undefined
        const plain: TextCard = {
          id: freshId(),
          type: 'text',
          text: textOf(op, 'text') ?? '',
          x: held(page ? at.x : (numberOf(op, 'x') ?? at.x)),
          y: held(page ? at.y : (numberOf(op, 'y') ?? at.y)),
          width: sized(op, 'width', DEFAULT_WIDTH),
          height: 0,
          ...(colour ? { color: colour } : {}),
          ...(printed === undefined ? {} : { bare: true, size: printed }),
        }
        const card = styled(plain, { ...op, color: undefined, colour: undefined })
        const line = Math.ceil((card.size ?? 0) * LEADING + 16)
        card.height = sized(op, 'height', Math.max(DEFAULT_HEIGHT, line))
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
      case 'style': {
        const node = nodeIn(now, id)
        if (node.type !== 'text') throw new Refused('bad_arguments', 'style changes a text card')
        now = replaced(now, styled(node, op))
        break
      }
      case 'move': {
        const node = nodeIn(now, id)
        const page = pageNamed(now, op)
        const corner = page ? placeOnPage(now, page, numberOf(op, 'x') ?? 0, numberOf(op, 'y') ?? 0) : null
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
        if (joined.id === null) throw new Refused('bad_arguments', 'a card cannot connect to itself')
        now = joined.canvas
        const label = textOf(op, 'label') ?? textOf(op, 'text')
        if (label) now = withLabel(now, joined.id, label)
        made.push(joined.id)
        break
      }
      case 'remove': {
        const there = [...now.nodes, ...now.edges, ...now.ink].some((one) => one.id === id)
        if (id === null || !there) throw new Refused('not_found', `there is no ${String(id)} on the canvas`)
        const page = now.nodes.find((node) => node.id === id)?.type === 'page'
        now = page ? (pageOperation(now, { op: 'remove_page', id })?.canvas ?? now) : removed(now, [id])
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
