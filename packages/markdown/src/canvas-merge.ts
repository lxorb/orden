/** Two copies of one canvas, put back together.
 *
 *  The rule is one sentence: everything on either side is kept, by id; where
 *  both sides have the same thing the one touched later wins; and a thing thrown
 *  away stays thrown away unless it was touched again afterwards. Two people
 *  drawing on one plane at the same time therefore both keep everything they
 *  added, which is the only behaviour a shared canvas can have. Nobody's card is
 *  ever a "conflict copy" they have to go and find.
 *
 *  It works because everything on a canvas already has an id and now has a time
 *  as well. `stamped` keeps the times honest by comparing a canvas with the one
 *  before it: every edit in the app replaces the objects it touches and leaves
 *  the rest as the very same objects, so "what changed" is a handful of
 *  identity comparisons rather than a deep diff, and no edit has to remember to
 *  write a timestamp.
 *
 *  Symmetric on purpose. Merging ours with theirs and theirs with ours gives the
 *  same file, so it does not matter whether the client or the worker does it, or
 *  which device gets there first. */

import { type Canvas, readCanvas, type Thing, writeCanvas } from './canvas'

/** How long a tombstone is kept, in milliseconds. Long enough that a tablet left
 *  in a drawer for a month cannot bring a deleted card back, short enough that a
 *  canvas edited for years does not carry a list of everything ever removed. */
export const TOMBSTONE_KEPT = 90 * 24 * 60 * 60 * 1000

function byId<T extends Thing>(things: readonly T[]): Map<string, T> {
  return new Map(things.map((thing) => [thing.id, thing]))
}

/** The canvas with its times brought up to date, given what it looked like
 *  before the edit.
 *
 *  Called once, where an edit is recorded, so nothing else in the app has to
 *  know that a canvas has times at all. What changed is worked out by identity:
 *  the operations that make a new canvas hand back the very same objects for
 *  everything they did not touch.
 *
 *  Something that comes back after being thrown away - an undo, or a paste of
 *  what was just deleted - loses its tombstone, or the merge would delete it
 *  again the moment the file reached another device. */
export function stamped(before: Canvas, after: Canvas, now: number): Canvas {
  const changed: string[] = []
  const removed: string[] = []
  const touched = { changed, removed }

  // A list at a time, and only the lists that are not the very same list. Drawing
  // one stroke on a plane of ten thousand touches the ink and leaves the nodes and
  // the edges exactly as they were, so there is nothing to compare in two of the
  // three; and the ink itself is the old list with one more on the end, which a walk
  // of references finds without building anything.
  //
  // What that was worth: this used to build two maps over every node, edge and
  // stroke and then look every one of them up, on every edit - which for an eraser
  // is every point of a drag. The browser blamed the pointer coming up for a
  // hundred and fifty milliseconds on a plane of ten thousand strokes, and this was
  // three of the walks in it.
  diff(before.nodes, after.nodes, touched)
  diff(before.edges, after.edges, touched)
  diff(before.ink, after.ink, touched)

  // A time against everything on the plane, which is what makes this the one place
  // that has to be right: a thing with no time loses every merge, and a time left
  // behind for something that is no longer there would keep a tombstone from being
  // written. So the plane is still walked once and the record still built from it -
  // what has gone is the two maps over all of it and the lookup per thing.
  const touchedIds = new Set(changed)
  const at: Record<string, number> = {}
  const when = (id: string) => (touchedIds.has(id) ? now : (before.at[id] ?? now))

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

  const gone: Record<string, number> = {}

  for (const [id, since] of Object.entries(before.gone)) {
    // A tombstone for something that is on the plane again is no longer true.
    if (at[id] !== undefined || now - since >= TOMBSTONE_KEPT) continue
    gone[id] = since
  }

  for (const id of removed) {
    if (at[id] === undefined) gone[id] = now
  }

  return { ...after, at, gone }
}

/** What changed between two versions of one list, by identity.
 *
 *  The operations that make a new canvas hand back the very same objects for
 *  everything they did not touch, so identity is the whole test. Two lists that are
 *  the same list changed nothing; otherwise the common prefix and the common suffix
 *  are walked off the ends - which is the whole of an append, an insert or one thing
 *  replaced - and only what is left between them is put into maps.
 *
 *  `changed` collects what is on the plane now and was not there in this form
 *  before; `removed` collects what has gone. */
function diff<T extends Thing>(
  before: readonly T[],
  after: readonly T[],
  touched: { changed: string[]; removed: string[] },
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

  // The common case is one of the two being empty: a stroke added, or a stroke
  // erased. A map is built only where both ends have something in them.
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
}

/** When something last changed, on one side. Zero for something that side has
 *  never seen, which loses to any time at all. */
function timeOf(canvas: Canvas, id: string): number {
  return canvas.at[id] ?? 0
}

/** Which of two versions of one thing to keep. The later one; and for two with
 *  the same time, the one whose written form sorts first, so both devices reach
 *  the same answer without talking to each other. */
function later<T extends Thing>(ours: T, ourTime: number, theirs: T, theirTime: number): T {
  if (ourTime !== theirTime) return ourTime > theirTime ? ours : theirs
  if (ours === theirs) return ours

  return JSON.stringify(ours) <= JSON.stringify(theirs) ? ours : theirs
}

/** One list merged: the union by id, each entry the later of the two versions,
 *  and anything a tombstone outlives left out.
 *
 *  The order is the same on both sides because it is worked out from both: a
 *  thing sits where it sits on the side that has it earlier, and two things that
 *  would sit in the same place are ordered by their ids. That is what makes the
 *  z order of a merged canvas the same on every device. */
function mergeList<T extends Thing>(
  ours: readonly T[],
  theirs: readonly T[],
  ourCanvas: Canvas,
  theirCanvas: Canvas,
  gone: Record<string, number>,
): T[] {
  const mine = byId(ours)
  const yours = byId(theirs)
  const places = new Map<string, number>()

  ours.forEach((thing, index) => places.set(thing.id, index))
  theirs.forEach((thing, index) => {
    const seen = places.get(thing.id)
    places.set(thing.id, seen === undefined ? index : Math.min(seen, index))
  })

  const out: { thing: T; place: number }[] = []

  for (const id of new Set([...mine.keys(), ...yours.keys()])) {
    const buried = gone[id]
    const ourTime = timeOf(ourCanvas, id)
    const theirTime = timeOf(theirCanvas, id)

    // A delete beats an edit made before it, and loses to one made after: the
    // card was put back, and putting it back is the newer word on the matter.
    if (buried !== undefined && buried >= Math.max(ourTime, theirTime)) continue

    const one = mine.get(id)
    const other = yours.get(id)
    const kept = one && other ? later(one, ourTime, other, theirTime) : (one ?? other)
    if (!kept) continue

    out.push({ thing: kept, place: places.get(id) ?? Infinity })
  }

  return out
    .sort((a, b) => (a.place === b.place ? (a.thing.id < b.thing.id ? -1 : 1) : a.place - b.place))
    .map((entry) => entry.thing)
}

/** Two canvases as one. Neither side is the base and neither is preferred: this
 *  is the whole of the conflict rule, and it is the same rule wherever it runs. */
export function merged(ours: Canvas, theirs: Canvas, now = Date.now()): Canvas {
  const gone: Record<string, number> = {}

  for (const [id, when] of Object.entries({ ...ours.gone, ...theirs.gone })) {
    const mine = ours.gone[id] ?? 0
    const yours = theirs.gone[id] ?? 0
    const buried = Math.max(mine, yours, when)
    if (now - buried >= TOMBSTONE_KEPT) continue

    gone[id] = buried
  }

  const kept = keptIcon(ours.icon ?? null, theirs.icon ?? null)
  const nodes = mergeList(ours.nodes, theirs.nodes, ours, theirs, gone)
  const held = new Set(nodes.map((node) => node.id))

  const at: Record<string, number> = {}
  for (const id of new Set([...Object.keys(ours.at), ...Object.keys(theirs.at)])) {
    if (gone[id] !== undefined && !held.has(id)) continue
    at[id] = Math.max(ours.at[id] ?? 0, theirs.at[id] ?? 0)
  }

  return {
    nodes,
    // An edge whose card the merge dropped has nowhere to be, and the format
    // has no place to put one that ends in the air.
    edges: mergeList(ours.edges, theirs.edges, ours, theirs, gone).filter(
      (edge) => held.has(edge.fromNode) && held.has(edge.toNode),
    ),
    ink: mergeList(ours.ink, theirs.ink, ours, theirs, gone),
    at,
    gone,
    icon: kept,
    iconColor: keptTint(ours, theirs, kept),
  }
}

/** The colour the merged file's icon is drawn in.
 *
 *  A colour belongs to the icon it colours, so only a side whose icon survived has
 *  anything to say: the other side chose its colour for a different picture. Where
 *  both named the same icon the same rule decides again, which is what keeps the two
 *  devices agreeing. */
function keptTint(ours: Canvas, theirs: Canvas, kept: string | null): string | null {
  const mine = (ours.icon ?? null) === kept ? (ours.iconColor ?? null) : null
  const yours = (theirs.icon ?? null) === kept ? (theirs.iconColor ?? null) : null

  return keptIcon(mine, yours)
}

/** The icon the merged file wears: the one either side names, and where both name
 *  one and they differ, the one that sorts first.
 *
 *  The same rule as everything else in here, read for a thing there is only one
 *  of: nothing on either side is lost, and the tie is broken the way `later`
 *  breaks one, so both devices reach the same file without talking. Which does
 *  mean an icon taken away on one device comes back if the other still had it -
 *  exactly what happens to a card deleted on one device and moved on the other,
 *  and for the same reason. Choosing an icon on an open canvas does not go through
 *  here at all; see `follow` in the app's canvas store. */
function keptIcon(ours: string | null, theirs: string | null): string | null {
  if (ours === null || ours === theirs) return theirs
  if (theirs === null) return ours

  return ours <= theirs ? ours : theirs
}

/** Two canvas files as one file. What the sync client and the worker both call,
 *  so the rule cannot differ between them.
 *
 *  Text that is not a canvas at all reads as an empty one, and an empty one
 *  merges to whatever the other side had: a truncated file on one device is
 *  never a reason to lose the drawing on the other. */
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
    canvas.nodes.length > 0 ||
    canvas.ink.length > 0 ||
    Object.keys(canvas.gone).length > 0 ||
    // An icon is the one thing an empty canvas can carry that a truncated file
    // cannot: unreadable text reads as an empty canvas wearing nothing, so a plane
    // nobody has drawn on yet still keeps the icon somebody chose for it.
    !!canvas.icon
  )
}
