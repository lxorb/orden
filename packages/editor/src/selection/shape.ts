/** The outline of a selection: one block, with its corners smoothed.
 *
 *  The view measures a selection as a handful of rectangles - the first line
 *  from where the selection began to the end of that line, one band for
 *  everything between, and the last line up to where it ended. Painted as
 *  rectangles those are boxes with a dozen hard corners in them. Traced as one
 *  outline they are a single block, and every corner can be rounded: the outer
 *  ones the way a button is, and the two where a narrow row meets a wide one
 *  the other way round, as a fillet, so the step reads as one piece rather than
 *  as two boxes stacked.
 *
 *  Nothing here touches the DOM, so the cases that are hard to see on a screen
 *  are tests instead of screenshots: a row of no width, rows whose left edges
 *  differ under a list's indent, right-to-left text, rows that do not meet, and
 *  a radius wider than the row it has to fit inside. */

/** A rectangle the view measured, in the document's own coordinates. */
export interface SelectionRect {
  left: number
  top: number
  width: number
  height: number
}

/** One continuous block of a selection: the box it needs, and its outline as an
 *  SVG path in that box's own coordinates. */
export interface SelectionBlock {
  left: number
  top: number
  width: number
  height: number
  path: string
}

/** Two edges closer together than this are the same edge. Sub-pixel differences
 *  come out of the measuring rather than out of the text, and a step nobody can
 *  see is worth less than a straight side. */
const SAME = 0.5

/** A radius below this is no arc at all, and writing one would only lengthen
 *  the path. */
const NO_ARC = 0.05

interface Point {
  x: number
  y: number
}

/** What one row of the selection covers, sideways. */
interface Run {
  left: number
  right: number
}

/** One row of the selection: a line's worth of it, as the runs it covers. Two
 *  of them only where the line reads in both directions. */
interface Row {
  top: number
  bottom: number
  runs: Run[]
}

/** A row's run with the row's height on it: what a block is a stack of. */
interface Band extends Run {
  top: number
  bottom: number
}

/** One selection's rectangles as the blocks they add up to, each with its
 *  corners rounded to `radius` or to as much of it as the block has room for. */
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

/** How much of one run the other one covers. Negative when they miss. */
function overlap(one: Run, other: Run): number {
  return Math.min(one.right, other.right) - Math.max(one.left, other.left)
}

/** The rectangles as rows, top to bottom. A rectangle of no width or no height
 *  is dropped: the view reports one for a selection that ends where a line
 *  begins, and there is nothing there to draw. */
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

/** A row's runs in order, with the ones that meet made one. A line that reads
 *  in both directions arrives as a rectangle per direction, and where two of
 *  them touch there is no corner. */
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

/** The rows cut into blocks: a stack of one band per row, which is what can be
 *  traced as a staircase.
 *
 *  A run carries on the block above it when the two rows meet and exactly one
 *  run up there overlaps it. Anything else starts a block of its own: rows that
 *  only touch at a corner are two shapes rather than one with the gap between
 *  them filled in, and where two runs join into one - which only a line reading
 *  in both directions does - the second of them is a shape of its own, because a
 *  stack has no way to say that two things became one. */
function stacks(rows: readonly Row[]): Band[][] {
  const blocks: Band[][] = []
  /** What the row above ended in: its bands, and the block each belongs to. */
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

/** A band whose edges all but line up with the band above it, lined up with it.
 *  What is left is a straight side instead of a hairline step with two arcs in
 *  it. */
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
  const left = Math.min(...lefts)
  const top = Math.min(...bands.map((band) => band.top))

  return {
    left,
    top,
    width: Math.max(...rights) - left,
    height: Math.max(...bands.map((band) => band.bottom)) - top,
  }
}

/** A block's outline, clockwise from its top left: across the top, down the
 *  right side stepping in or out wherever a row changes width, along the
 *  bottom, and back up the left. */
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

/** The corners that are corners. A point that repeats its neighbour, or that
 *  sits on the straight line between the two around it, is not one - and left in
 *  it would take an arc of nothing and split a side in two. */
function pruned(corners: readonly Point[]): Point[] {
  const kept: Point[] = []

  for (const at of corners) {
    const last = kept[kept.length - 1]
    if (!last || !near(last.x, at.x) || !near(last.y, at.y)) kept.push(at)
  }

  const first = kept[0]
  const last = kept[kept.length - 1]
  if (first && last && kept.length > 1 && near(first.x, last.x) && near(first.y, last.y)) kept.pop()

  // Judged against the neighbours it came in with, so a whole run of points on
  // one line goes in a single pass.
  return kept.filter((at, index) => {
    const before = kept[(index + kept.length - 1) % kept.length]
    const after = kept[(index + 1) % kept.length]
    if (!before || !after) return true

    const straight =
      (near(before.x, at.x) && near(at.x, after.x)) || (near(before.y, at.y) && near(at.y, after.y))
    return !straight
  })
}

/** The outline as one SVG path, with an arc at every corner. Which way a corner
 *  turns is what says which way its arc bends, so a step into the block comes
 *  out as a fillet without anything having to know which corner it is looking
 *  at. Each arc is held to half of both sides it sits between, which is what
 *  keeps two of them from meeting in the middle of a short one. */
function rounded(corners: readonly Point[], radius: number): string {
  const parts: string[] = []

  for (const [index, at] of corners.entries()) {
    const before = corners[(index + corners.length - 1) % corners.length]
    const after = corners[(index + 1) % corners.length]
    // Both are there, the index being taken modulo the length: a check rather
    // than a cast, because only the compiler needs convincing.
    if (!before || !after) continue

    const into = { x: at.x - before.x, y: at.y - before.y }
    const away = { x: after.x - at.x, y: after.y - at.y }
    const reach = Math.hypot(into.x, into.y)
    const leave = Math.hypot(away.x, away.y)
    if (reach === 0 || leave === 0) continue

    const arc = Math.min(radius, reach / 2, leave / 2)
    const start = { x: at.x - (into.x / reach) * arc, y: at.y - (into.y / reach) * arc }
    const end = { x: at.x + (away.x / leave) * arc, y: at.y + (away.y / leave) * arc }
    // Turning right is a corner of the block; turning left is a step into it,
    // and its arc has to bend the other way to fill the notch.
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

/** Two decimals, which is finer than a screen and short enough that the path
 *  read back is the same string for the same selection. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}
