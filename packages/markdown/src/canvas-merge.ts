import { type Canvas, noTimes, readCanvas, type Thing, timeIn, writeCanvas } from './canvas'
import { holdsExtras, mergedExtras } from './canvas-extras'

export const TOMBSTONE_KEPT = 90 * 24 * 60 * 60 * 1000

function byId<T extends Thing>(things: readonly T[]): Map<string, T> {
  return new Map(things.map((thing) => [thing.id, thing]))
}

export function stamped(before: Canvas, after: Canvas, now: number): Canvas {
  const changed: string[] = []
  const removed: string[] = []
  const shifted: string[] = []
  const touched = { changed, removed, shifted }

  diff(before.nodes, after.nodes, touched)
  diff(before.edges, after.edges, touched)
  diff(before.ink, after.ink, touched)

  const touchedIds = new Set(changed)
  const at = noTimes()
  const when = (id: string) => (touchedIds.has(id) ? now : (timeIn(before.at, id) ?? now))

  for (const thing of after.nodes) {
    const id = thing.id
    at[id] = when(id)
  }
  for (const thing of after.edges) {
    const id = thing.id
    at[id] = when(id)
  }
  for (const thing of after.ink) {
    const id = thing.id
    at[id] = when(id)
  }

  const gone = noTimes()

  for (const [id, since] of Object.entries(before.gone)) {
    if (at[id] !== undefined || now - since >= TOMBSTONE_KEPT) continue
    gone[id] = since
  }

  for (const id of removed) {
    if (at[id] === undefined) gone[id] = now
  }

  const out: Canvas = { ...after, at, gone }
  const moved = movesAfter(before.moved, shifted, removed, now)
  if (moved) out.moved = moved
  else delete out.moved

  return out
}

function movesAfter(
  was: Record<string, number> | undefined,
  shifted: readonly string[],
  removed: readonly string[],
  now: number,
): Record<string, number> | undefined {
  const dropped = was ? removed.filter((id) => timeIn(was, id) !== undefined) : []
  if (!shifted.length && !dropped.length) return was

  const moved = noTimes()
  const gone = new Set(dropped)
  for (const [id, since] of Object.entries(was ?? {})) {
    if (!gone.has(id)) moved[id] = since
  }
  for (const id of shifted) moved[id] = now

  return Object.keys(moved).length ? moved : undefined
}

function diff<T extends Thing>(
  before: readonly T[],
  after: readonly T[],
  touched: { changed: string[]; removed: string[]; shifted: string[] },
): void {
  if (before === after) return

  let head = 0
  const shortest = Math.min(before.length, after.length)
  while (head < shortest && before[head] === after[head]) head++

  let tail = 0
  while (
    tail < shortest - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++
  }

  const wasMiddle = before.slice(head, before.length - tail)
  const isMiddle = after.slice(head, after.length - tail)

  if (wasMiddle.length === 0) {
    for (const thing of isMiddle) touched.changed.push(thing.id)
    return
  }

  if (isMiddle.length === 0) {
    for (const thing of wasMiddle) touched.removed.push(thing.id)
    return
  }

  const was = byId(wasMiddle)
  const is = byId(isMiddle)

  for (const [id, thing] of is) {
    if (was.get(id) !== thing) touched.changed.push(id)
  }

  for (const id of was.keys()) {
    if (!is.has(id)) touched.removed.push(id)
  }

  const places = new Map(wasMiddle.map((thing, index) => [thing.id, index]))
  const both = isMiddle.filter((thing) => places.has(thing.id))
  const stayed = standing(
    both,
    (one, other) => (places.get(one.id) ?? 0) < (places.get(other.id) ?? 0),
  )
  for (const [index, thing] of both.entries()) {
    if (!stayed.has(index)) touched.shifted.push(thing.id)
  }
}

export function standing<T extends object>(
  items: readonly T[],
  before: (one: T, other: T) => boolean,
): Set<number> {
  const starts: number[] = []
  const next: number[] = []

  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (!item) continue

    let low = 0
    let high = starts.length
    while (low < high) {
      const middle = (low + high) >> 1
      const start = items[starts[middle] ?? 0]
      if (start && before(item, start)) low = middle + 1
      else high = middle
    }

    next[index] = starts[low - 1] ?? -1
    starts[low] = index
  }

  const out = new Set<number>()
  let at = starts[starts.length - 1] ?? -1
  while (at >= 0) {
    out.add(at)
    at = next[at] ?? -1
  }

  return out
}

function timeOf(canvas: Canvas, id: string): number {
  return timeIn(canvas.at, id) ?? 0
}

function later<T extends Thing>(ours: T, ourTime: number, theirs: T, theirTime: number): T {
  if (ourTime !== theirTime) return ourTime > theirTime ? ours : theirs
  if (ours === theirs) return ours

  return JSON.stringify(ours) <= JSON.stringify(theirs) ? ours : theirs
}

function mergeList<T extends Thing>(
  ours: readonly T[],
  theirs: readonly T[],
  ourCanvas: Canvas,
  theirCanvas: Canvas,
  gone: Record<string, number>,
): T[] {
  const mine = byId(ours)
  const yours = byId(theirs)
  const ourMove = (id: string) => timeIn(ourCanvas.moved ?? {}, id) ?? 0
  const theirMove = (id: string) => timeIn(theirCanvas.moved ?? {}, id) ?? 0
  const shared = (id: string) => mine.has(id) && yours.has(id) && ourMove(id) === theirMove(id)

  const ourList = [...mine.values()]
  const theirList = [...yours.values()]
  const anchors = settled(
    ourList,
    theirList,
    shared,
    (id) => timeOf(ourCanvas, id),
    (id) => timeOf(theirCanvas, id),
  )
  const ourGaps = gapsIn(ourList, shared, (id) => !yours.has(id) || ourMove(id) >= theirMove(id))
  const theirGaps = gapsIn(theirList, shared, (id) => !mine.has(id) || theirMove(id) >= ourMove(id))
  const touchedAt = (id: string) =>
    Math.max(ourMove(id), theirMove(id)) || Math.max(timeOf(ourCanvas, id), timeOf(theirCanvas, id))

  const out: T[] = []
  const keep = (id: string) => {
    const buried = gone[id]
    const ourTime = timeOf(ourCanvas, id)
    const theirTime = timeOf(theirCanvas, id)

    if (buried !== undefined && buried >= Math.max(ourTime, theirTime)) return

    const one = mine.get(id)
    const other = yours.get(id)
    const kept = one && other ? later(one, ourTime, other, theirTime) : (one ?? other)
    if (kept) out.push(kept)
  }

  for (let gap = 0; gap <= anchors.length; gap++) {
    const left = ourGaps[gap] ?? []
    const right = theirGaps[gap] ?? []
    let i = 0
    let j = 0

    while (i < left.length || j < right.length) {
      const one = left[i]
      const other = right[j]
      const first =
        one === undefined
          ? false
          : other === undefined
            ? true
            : touchedAt(one) === touchedAt(other)
              ? one < other
              : touchedAt(one) < touchedAt(other)
      if (first) i++
      else j++
      keep((first ? one : other) ?? '')
    }

    const anchor = anchors[gap]
    if (anchor !== undefined) keep(anchor)
  }

  return out
}

function settled(
  ours: readonly Thing[],
  theirs: readonly Thing[],
  shared: (id: string) => boolean,
  ourTime: (id: string) => number,
  theirTime: (id: string) => number,
): string[] {
  const one = ours.filter((thing) => shared(thing.id)).map((thing) => thing.id)
  const other = theirs.filter((thing) => shared(thing.id)).map((thing) => thing.id)
  if (one.every((id, index) => id === other[index])) return one

  const places = new Map(one.map((id, index) => [id, index]))
  other.forEach((id, index) => {
    const seen = places.get(id) ?? index
    const mine = ourTime(id)
    const yours = theirTime(id)
    places.set(id, yours > mine ? index : mine > yours ? seen : Math.min(seen, index))
  })

  return one.sort((a, b) => {
    const gap = (places.get(a) ?? 0) - (places.get(b) ?? 0)
    return gap || (a < b ? -1 : 1)
  })
}

function gapsIn(
  list: readonly Thing[],
  shared: (id: string) => boolean,
  stands: (id: string) => boolean,
): string[][] {
  const gaps: string[][] = [[]]
  for (const { id } of list) {
    if (shared(id)) gaps.push([])
    else if (stands(id)) gaps[gaps.length - 1]?.push(id)
  }

  return gaps
}

export function merged(ours: Canvas, theirs: Canvas, now = Date.now()): Canvas {
  const gone = noTimes()

  for (const [id, when] of Object.entries({ ...ours.gone, ...theirs.gone })) {
    const mine = timeIn(ours.gone, id) ?? 0
    const yours = timeIn(theirs.gone, id) ?? 0
    const buried = Math.max(mine, yours, when)
    if (now - buried >= TOMBSTONE_KEPT) continue

    gone[id] = buried
  }

  const kept = keptIcon(ours.icon ?? null, theirs.icon ?? null)
  const nodes = mergeList(ours.nodes, theirs.nodes, ours, theirs, gone)
  const cards = new Set(nodes.map((node) => node.id))
  const edges = mergeList(ours.edges, theirs.edges, ours, theirs, gone).filter(
    (edge) => cards.has(edge.fromNode) && cards.has(edge.toNode),
  )
  const ink = mergeList(ours.ink, theirs.ink, ours, theirs, gone)

  const held = new Set([...cards, ...edges.map((edge) => edge.id), ...ink.map((one) => one.id)])

  const at = noTimes()
  for (const id of new Set([...Object.keys(ours.at), ...Object.keys(theirs.at)])) {
    if (gone[id] !== undefined && !held.has(id)) continue
    at[id] = Math.max(timeIn(ours.at, id) ?? 0, timeIn(theirs.at, id) ?? 0)
  }

  const moved = noTimes()
  for (const id of new Set([
    ...Object.keys(ours.moved ?? {}),
    ...Object.keys(theirs.moved ?? {}),
  ])) {
    if (!held.has(id)) continue
    moved[id] = Math.max(timeIn(ours.moved ?? {}, id) ?? 0, timeIn(theirs.moved ?? {}, id) ?? 0)
  }

  return {
    nodes,
    edges,
    ink,
    at,
    gone,
    icon: kept,
    iconColor: keptTint(ours, theirs, kept),
    ...(Object.keys(moved).length ? { moved } : {}),
    ...(holdsExtras(ours.extras) || holdsExtras(theirs.extras)
      ? { extras: mergedExtras(ours.extras, theirs.extras) }
      : {}),
  }
}

function keptTint(ours: Canvas, theirs: Canvas, kept: string | null): string | null {
  const mine = (ours.icon ?? null) === kept ? (ours.iconColor ?? null) : null
  const yours = (theirs.icon ?? null) === kept ? (theirs.iconColor ?? null) : null

  return keptIcon(mine, yours)
}

function keptIcon(ours: string | null, theirs: string | null): string | null {
  if (ours === null || ours === theirs) return theirs
  if (theirs === null) return ours

  return ours <= theirs ? ours : theirs
}

export function mergeCanvasFiles(ours: string, theirs: string, now = Date.now()): string {
  if (ours === theirs) return ours

  const mine = readCanvas(ours)
  const yours = readCanvas(theirs)

  if (!weighs(mine)) return theirs
  if (!weighs(yours)) return ours

  return writeCanvas(merged(mine, yours, now))
}

function weighs(canvas: Canvas): boolean {
  return (
    holdsExtras(canvas.extras) ||
    canvas.nodes.length > 0 ||
    canvas.ink.length > 0 ||
    Object.keys(canvas.gone).length > 0 ||
    !!canvas.icon
  )
}
