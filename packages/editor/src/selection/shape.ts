export interface SelectionRect {
  left: number
  top: number
  width: number
  height: number
}

export interface SelectionBlock {
  left: number
  top: number
  width: number
  height: number
  path: string
}

const SAME = 0.5

const NO_ARC = 0.05

interface Point {
  x: number
  y: number
}

interface Run {
  left: number
  right: number
}

interface Row {
  top: number
  bottom: number
  runs: Run[]
}

interface Band extends Run {
  top: number
  bottom: number
}

export function selectionBlocks(rects: readonly SelectionRect[], radius: number): SelectionBlock[] {
  const blocks: SelectionBlock[] = []

  for (const bands of stacks(rows(rects))) {
    const box = boxOf(bands)
    const corners = outline(bands).map((at) => ({ x: at.x - box.left, y: at.y - box.top }))
    if (corners.length < 3) continue

    blocks.push({ ...box, path: rounded(corners, Math.max(0, radius)) })
  }

  return blocks
}

function near(one: number, other: number): boolean {
  return Math.abs(one - other) <= SAME
}

function overlap(one: Run, other: Run): number {
  return Math.min(one.right, other.right) - Math.max(one.left, other.left)
}

function rows(rects: readonly SelectionRect[]): Row[] {
  const found: Row[] = []

  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue

    const top = rect.top
    const bottom = rect.top + rect.height
    const run = { left: rect.left, right: rect.left + rect.width }
    const row = found.find((one) => near(one.top, top) && near(one.bottom, bottom))

    if (row) row.runs.push(run)
    else found.push({ top, bottom, runs: [run] })
  }

  found.sort((one, other) => one.top - other.top)
  for (const row of found) row.runs = joined(row.runs)

  return found
}

function joined(runs: readonly Run[]): Run[] {
  const order = [...runs].sort((one, other) => one.left - other.left)
  const merged: Run[] = []

  for (const run of order) {
    const last = merged[merged.length - 1]
    if (last && run.left <= last.right + SAME) last.right = Math.max(last.right, run.right)
    else merged.push({ ...run })
  }

  return merged
}

function stacks(rows: readonly Row[]): Band[][] {
  const blocks: Band[][] = []
  let above: { band: Band; block: Band[] }[] = []

  for (const row of rows) {
    const ends: { band: Band; block: Band[] }[] = []
    const carried = new Set<Band[]>()

    for (const run of row.runs) {
      const meeting = above.filter(
        (one) => near(one.band.bottom, row.top) && overlap(one.band, run) > SAME,
      )
      const carries = meeting.length === 1 ? meeting[0] : undefined

      if (carries && !carried.has(carries.block)) {
        const band = snapped(bandOf(row, run), carries.band)
        carries.block.push(band)
        carried.add(carries.block)
        ends.push({ band, block: carries.block })
        continue
      }

      const band = bandOf(row, run)
      const block = [band]
      blocks.push(block)
      ends.push({ band, block })
    }

    above = ends
  }

  return blocks
}

function bandOf(row: Row, run: Run): Band {
  return { top: row.top, bottom: row.bottom, left: run.left, right: run.right }
}

function snapped(band: Band, above: Band): Band {
  return {
    ...band,
    left: near(band.left, above.left) ? above.left : band.left,
    right: near(band.right, above.right) ? above.right : band.right,
  }
}

function boxOf(bands: readonly Band[]): Omit<SelectionBlock, 'path'> {
  const lefts = bands.map((band) => band.left)
  const rights = bands.map((band) => band.right)
  const left = lefts.reduce((low, one) => Math.min(low, one), Infinity)
  const top = bands.map((band) => band.top).reduce((low, one) => Math.min(low, one), Infinity)

  return {
    left,
    top,
    width: rights.reduce((high, one) => Math.max(high, one), -Infinity) - left,
    height:
      bands.map((band) => band.bottom).reduce((high, one) => Math.max(high, one), -Infinity) - top,
  }
}

function outline(bands: readonly Band[]): Point[] {
  const first = bands[0]
  if (!first) return []

  const corners: Point[] = [
    { x: first.left, y: first.top },
    { x: first.right, y: first.top },
  ]

  let above = first
  for (const band of bands.slice(1)) {
    corners.push({ x: above.right, y: above.bottom }, { x: band.right, y: above.bottom })
    above = band
  }

  corners.push({ x: above.right, y: above.bottom }, { x: above.left, y: above.bottom })

  for (const band of [...bands].reverse().slice(1)) {
    corners.push({ x: above.left, y: band.bottom }, { x: band.left, y: band.bottom })
    above = band
  }

  return pruned(corners)
}

function pruned(corners: readonly Point[]): Point[] {
  const kept: Point[] = []

  for (const at of corners) {
    const last = kept[kept.length - 1]
    if (!last || !near(last.x, at.x) || !near(last.y, at.y)) kept.push(at)
  }

  const first = kept[0]
  const last = kept[kept.length - 1]
  if (first && last && kept.length > 1 && near(first.x, last.x) && near(first.y, last.y)) kept.pop()

  return kept.filter((at, index) => {
    const before = kept[(index + kept.length - 1) % kept.length]
    const after = kept[(index + 1) % kept.length]
    if (!before || !after) return true

    const straight =
      (near(before.x, at.x) && near(at.x, after.x)) || (near(before.y, at.y) && near(at.y, after.y))
    return !straight
  })
}

function rounded(corners: readonly Point[], radius: number): string {
  const parts: string[] = []

  for (const [index, at] of corners.entries()) {
    const before = corners[(index + corners.length - 1) % corners.length]
    const after = corners[(index + 1) % corners.length]
    if (!before || !after) continue

    const into = { x: at.x - before.x, y: at.y - before.y }
    const away = { x: after.x - at.x, y: after.y - at.y }
    const reach = Math.hypot(into.x, into.y)
    const leave = Math.hypot(away.x, away.y)
    if (reach === 0 || leave === 0) continue

    const arc = Math.min(radius, reach / 2, leave / 2)
    const start = { x: at.x - (into.x / reach) * arc, y: at.y - (into.y / reach) * arc }
    const end = { x: at.x + (away.x / leave) * arc, y: at.y + (away.y / leave) * arc }
    const sweep = into.x * away.y - into.y * away.x > 0 ? 1 : 0

    parts.push(`${index === 0 ? 'M' : 'L'} ${place(start)}`)
    if (arc > NO_ARC) parts.push(`A ${round(arc)} ${round(arc)} 0 0 ${sweep} ${place(end)}`)
  }

  parts.push('Z')

  return parts.join(' ')
}

function place(at: Point): string {
  return `${round(at.x)} ${round(at.y)}`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
