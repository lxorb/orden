import type { InkStroke, PageNode } from '@orden/markdown/canvas'
import { strokeBox } from '../../plane/src/api'
import { sharpness } from '../../pdf/src/api'

export interface Sheet {
  width: number
  height: number
}

export interface Shelves {
  columns: number
  tops: number[]
  heights: number[]
  total: number
}

export interface Shelf {
  least: number
  gap: number
  edge: number
}

export interface Shown {
  from: number
  to: number
  above: number
  below: number
}

export function shelvesOf(sheets: readonly Sheet[], wide: number, shelf: Shelf): Shelves {
  const { least, gap, edge } = shelf
  const columns = Math.max(1, Math.floor((wide + gap) / (least + gap)))
  const cell = Math.max(0, (wide - gap * (columns - 1)) / columns)
  const inner = Math.max(0, cell - 2 * edge)

  const tops: number[] = []
  const heights: number[] = []
  let y = 0
  for (let first = 0; first < sheets.length; first += columns) {
    let tall = 0
    for (const sheet of sheets.slice(first, first + columns)) {
      const ratio = sheet.width > 0 ? sheet.height / sheet.width : 1
      tall = Math.max(tall, inner * ratio + 2 * edge)
    }
    tops.push(y)
    heights.push(tall)
    y += tall + gap
  }

  return { columns, tops, heights, total: Math.max(0, y - gap) }
}

export interface ThumbSize {
  scale: number
  tall: number
  ratio: number
  width: number
  height: number
}

export function thumbSize(sheet: Sheet, wide: number, wanted: number): ThumbSize {
  const scale = sheet.width > 0 ? wide / sheet.width : 1
  const tall = sheet.height * scale
  const ratio = sharpness(wide, tall, wanted)
  return {
    scale,
    tall,
    ratio,
    width: Math.max(1, Math.round(wide * ratio)),
    height: Math.max(1, Math.round(tall * ratio)),
  }
}

export function shownOf(shelves: Shelves, count: number, top: number, room: number): Shown {
  const { columns, tops, heights, total } = shelves
  if (!tops.length || count <= 0) return { from: 0, to: 0, above: 0, below: 0 }

  const reach = Math.max(0, room) / 2
  const first = rowAt(tops, top - reach)
  const last = rowAt(tops, top + Math.max(0, room) + reach)
  const end = (tops[last] ?? 0) + (heights[last] ?? 0)

  return {
    from: first * columns,
    to: Math.min(count, (last + 1) * columns),
    above: tops[first] ?? 0,
    below: Math.max(0, total - end),
  }
}

function rowAt(tops: readonly number[], y: number): number {
  let low = 0
  let high = tops.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((tops[middle] ?? 0) <= y) low = middle
    else high = middle - 1
  }

  return low
}

export interface SheetDrawn {
  x: number
  y: number
  width: number
  height: number
  file: string | null
  page: number | null
  ink: readonly InkStroke[]
  palette: unknown
}

export function sheetDrawn(
  page: PageNode,
  ink: readonly InkStroke[],
  palette: unknown,
): SheetDrawn {
  const { x, y, width, height } = page
  return {
    x,
    y,
    width,
    height,
    file: page.file ?? null,
    page: page.page ?? null,
    palette,
    ink: ink.filter((stroke) => {
      const box = strokeBox(stroke)
      return (
        box.x < x + width && x < box.x + box.width && box.y < y + height && y < box.y + box.height
      )
    }),
  }
}

export function sameSheet(one: SheetDrawn, other: SheetDrawn): boolean {
  return (
    one.x === other.x &&
    one.y === other.y &&
    one.width === other.width &&
    one.height === other.height &&
    one.file === other.file &&
    one.page === other.page &&
    one.palette === other.palette &&
    one.ink.length === other.ink.length &&
    one.ink.every((stroke, at) => stroke === other.ink[at])
  )
}
