export interface Row {
  change: 'same' | 'added' | 'removed'
  text: string
  before?: number
  after?: number
}

const MOST_LINES = 1500

function lines(text: string): string[] {
  return text.length ? text.split('\n') : []
}

export interface Work {
  matched: number
  cells: number
}

function nothing(): Work {
  return { matched: 0, cells: 0 }
}

const work = nothing()

export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

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

export function diffCount(rows: readonly Row[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.change === 'added') added++
    else if (row.change === 'removed') removed++
  }

  return { added, removed }
}

export function trimmed(rows: readonly Row[], context = 2): Row[] {
  const wanted = new Set<number>()
  for (const [at, row] of rows.entries()) {
    if (row.change === 'same') continue
    for (let near = at - context; near <= at + context; near++) wanted.add(near)
  }

  return rows.filter((_, at) => wanted.has(at))
}
