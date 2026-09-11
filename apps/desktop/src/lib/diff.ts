/** A line diff, for showing what an earlier version of a note would change.
 *
 *  Compact rather than complete: the lines both texts share are what makes a
 *  diff readable, and what is left either side of them is what changed. Written
 *  here rather than pulled in, because it is forty lines and a dependency is
 *  forever. */

export interface Row {
  /** Whether this line is in both texts, only in the newer one, or only in the
   *  older one. */
  change: 'same' | 'added' | 'removed'
  text: string
  /** Which line this is in the text it belongs to, counting from one. Absent on
   *  the side that does not have it. */
  before?: number
  after?: number
}

/** Beyond this many lines each side, the longest common run is worked out for a
 *  smaller middle: the table below is one cell per pair, and a note nobody
 *  meant to compare should not stop the app while it is filled in. What is over
 *  the limit reads as one replacement, which is the honest summary of two texts
 *  with nothing much in common. */
const MOST_LINES = 1500

function lines(text: string): string[] {
  return text.length ? text.split('\n') : []
}

/** What a diff did, counted.
 *
 *  Counted rather than timed, and here rather than in the test because only this
 *  file knows what it is doing. diff.test.ts held a stopwatch to two versions of a
 *  four thousand line note and asked for under 100 ms; a runner with the rest of
 *  the suite on it fails that while the diff is exactly as fast as it was, because
 *  what a wall clock measures is partly the queue in front of the code. These two
 *  are the same numbers on a busy machine as on an idle one, and between them they
 *  say the thing that keeps a diff off the main thread: the table is only ever
 *  filled in for the handful of lines two versions of a note disagree about.
 *
 *  Two adds, one of them inside the table's own loop. */
export interface Work {
  /** Lines matched off at the head and the tail before the table, which is most
   *  of a note. */
  matched: number
  /** Cells of the table filled in, one per pair of lines left over. The one worth
   *  catching: it is the square of what is left, so a change that stopped matching
   *  the head and the tail off first turns one cell into sixteen million. */
  cells: number
}

function nothing(): Work {
  return { matched: 0, cells: 0 }
}

const work = nothing()

/** What the diffs since this was last asked did, and zero from here. */
export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

/** The longest common subsequence of two lists of lines, as the pairs of
 *  positions that match, oldest first.
 *
 *  The plain table: one row per line of `before`, one column per line of
 *  `after`, each cell the length of the longest run up to there. Walked back
 *  from the corner it gives the matches. */
function common(before: string[], after: string[]): [number, number][] {
  const rows = before.length
  const columns = after.length
  const width = columns + 1
  const lengths = new Uint32Array((rows + 1) * width)

  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      work.cells += 1
      const at = row * width + column
      lengths[at] =
        before[row] === after[column]
          ? (lengths[at + width + 1] ?? 0) + 1
          : Math.max(lengths[at + width] ?? 0, lengths[at + 1] ?? 0)
    }
  }

  const pairs: [number, number][] = []
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    if (before[row] === after[column]) {
      pairs.push([row, column])
      row++
      column++
    } else if (
      (lengths[(row + 1) * width + column] ?? 0) >= (lengths[row * width + column + 1] ?? 0)
    ) {
      row++
    } else {
      column++
    }
  }

  return pairs
}

/** What it would take to turn `before` into `after`, line by line.
 *
 *  Lines both texts start and end with are matched off first: two versions of a
 *  note are mostly the same note, so the interesting part is a handful of lines
 *  in the middle and the table only ever has to cover those. */
export function lineDiff(before: string, after: string): Row[] {
  const old = lines(before)
  const now = lines(after)

  const rows: Row[] = []
  let head = 0
  while (head < old.length && head < now.length && old[head] === now[head]) head++

  let tail = 0
  while (
    tail < old.length - head &&
    tail < now.length - head &&
    old[old.length - 1 - tail] === now[now.length - 1 - tail]
  ) {
    tail++
  }

  work.matched += head + tail
  const oldMiddle = old.slice(head, old.length - tail)
  const nowMiddle = now.slice(head, now.length - tail)

  for (let at = 0; at < head; at++) {
    rows.push({ change: 'same', text: old[at] ?? '', before: at + 1, after: at + 1 })
  }

  const pairs =
    oldMiddle.length > MOST_LINES && nowMiddle.length > MOST_LINES
      ? []
      : common(oldMiddle, nowMiddle)

  let oldAt = 0
  let nowAt = 0
  const emit = (untilOld: number, untilNow: number) => {
    while (oldAt < untilOld) {
      rows.push({ change: 'removed', text: oldMiddle[oldAt] ?? '', before: head + oldAt + 1 })
      oldAt++
    }
    while (nowAt < untilNow) {
      rows.push({ change: 'added', text: nowMiddle[nowAt] ?? '', after: head + nowAt + 1 })
      nowAt++
    }
  }

  for (const [oldLine, nowLine] of pairs) {
    emit(oldLine, nowLine)
    rows.push({
      change: 'same',
      text: oldMiddle[oldLine] ?? '',
      before: head + oldLine + 1,
      after: head + nowLine + 1,
    })
    oldAt = oldLine + 1
    nowAt = nowLine + 1
  }
  emit(oldMiddle.length, nowMiddle.length)

  for (let at = 0; at < tail; at++) {
    const oldLine = old.length - tail + at
    const nowLine = now.length - tail + at
    rows.push({
      change: 'same',
      text: old[oldLine] ?? '',
      before: oldLine + 1,
      after: nowLine + 1,
    })
  }

  return rows
}

/** How many lines a diff adds and takes away, for a line that says so without
 *  anybody counting. */
export function diffCount(rows: readonly Row[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.change === 'added') added++
    else if (row.change === 'removed') removed++
  }

  return { added, removed }
}

/** The rows worth showing: every change, with `context` unchanged lines either
 *  side of it, and the runs between them left out. A diff of two versions of a
 *  long note is otherwise the whole note with three lines coloured. */
export function trimmed(rows: readonly Row[], context = 2): Row[] {
  const wanted = new Set<number>()
  for (const [at, row] of rows.entries()) {
    if (row.change === 'same') continue
    for (let near = at - context; near <= at + context; near++) wanted.add(near)
  }

  return rows.filter((_, at) => wanted.has(at))
}
