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
