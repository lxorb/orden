import {
  added,
  moved,
  onPage,
  pagesOf,
  removed as pageRemoved,
  settled,
} from '@orden/markdown/pages'
import type { Canvas, CanvasNode, PageNode } from '../../canvas/format'
import { Refused } from './problem'

const MARGIN = 40

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function pageNumberOf(pages: readonly PageNode[], box: Box): number | null {
  const at = pages.findIndex((page) => onPage({ points: [{ x: box.x, y: box.y }] }, page))
  return at < 0 ? null : at + 1
}

export function readablePages(canvas: Canvas) {
  const laid = settled(canvas)
  const pages = pagesOf(laid)

  return {
    pages: pages.map((page, at) => ({
      id: page.id,
      number: at + 1,
      paper: page.paper,
      pattern: page.pattern,
      width: page.width,
      height: page.height,
      ...(page.file ? { pdf: { file: page.file, page: page.page } } : {}),
      ink: laid.ink.filter((stroke) => onPage(stroke, page)).length,
    })),
    nodes: laid.nodes
      .filter((node) => node.type !== 'page')
      .map((node) => ({ ...node, page: pageNumberOf(pages, node) })),
    edges: laid.edges,
    ink: laid.ink.length,
  }
}

export function pageIn(canvas: Canvas, named: unknown): PageNode {
  const pages = pagesOf(canvas)
  const found =
    typeof named === 'number'
      ? pages[Math.round(named) - 1]
      : pages.find((page) => page.id === named)
  if (!found) throw new Refused('not_found', `there is no page ${String(named)}`)

  return found
}

export function placeOnPage(
  canvas: Canvas,
  page: PageNode,
  x: number | null,
  y: number | null,
): { x: number; y: number } {
  if (x !== null || y !== null) {
    return { x: page.x + (x ?? MARGIN), y: page.y + (y ?? MARGIN) }
  }

  const on = canvas.nodes.filter(
    (node: CanvasNode) => node.type !== 'page' && pageNumberOf([page], node) !== null,
  )
  const lowest = on
    .map((node) => node.y + node.height + MARGIN)
    .reduce((high, one) => Math.max(high, one), page.y + MARGIN)
  return { x: page.x + MARGIN, y: Math.min(lowest, page.y + page.height - MARGIN) }
}

export function hasPages(canvas: Canvas): boolean {
  return pagesOf(canvas).length > 0
}

export function pageOperation(
  canvas: Canvas,
  op: Record<string, unknown>,
): { canvas: Canvas; made?: string } | null {
  switch (op.op) {
    case 'add_page': {
      const after = op.after === undefined ? null : pageIn(canvas, op.after).id
      const put = added(canvas, after)
      return { canvas: put.canvas, made: put.id }
    }

    case 'remove_page': {
      const page = pageIn(canvas, op.id ?? op.page)
      if (pagesOf(canvas).length < 2) {
        throw new Refused('bad_arguments', 'the last page is never taken away')
      }
      return { canvas: pageRemoved(canvas, page.id) }
    }

    case 'move_page': {
      const page = pageIn(canvas, op.id ?? op.page)
      const to = op.to
      if (typeof to !== 'number') throw new Refused('bad_arguments', 'move_page says to')
      return { canvas: moved(canvas, page.id, to - 1) }
    }

    default:
      return null
  }
}
