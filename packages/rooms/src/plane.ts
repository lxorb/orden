import {
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  edgeOf,
  type InkStroke,
  nodeOf,
  packed,
  strokeOf,
  type Thing,
} from '@orden/markdown/canvas'
import { extrasRead, extrasText, holdsExtras } from '@orden/markdown/canvas-extras'
import { standing } from '@orden/markdown/canvas-merge'
import * as Y from 'yjs'
import { fold } from './fold'

export const PLANE = 'canvas'
export const BURIED = 'gone'
export const EXTRAS = 'extras'
const HELD = 'held'

type ThingKind = 'node' | 'edge' | 'ink'

const KIND = 'kind'
const AT = 'at'
const Z = 'z'
const MOVED = 'moved'
const ADDED: readonly string[] = [KIND, AT, Z, MOVED]

export function planeOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(PLANE)
}

export function buriedOf(doc: Y.Doc): Y.Map<number> {
  return doc.getMap(BURIED)
}

export function rootsOf(doc: Y.Doc): Y.Map<unknown>[] {
  return [doc.getMap(PLANE), doc.getMap(BURIED), doc.getMap(EXTRAS)]
}

function putExtras(doc: Y.Doc, canvas: Canvas) {
  const held = doc.getMap<string>(EXTRAS)
  const text = holdsExtras(canvas.extras) ? extrasText(canvas.extras) : null
  if (text === null) {
    if (held.has(HELD)) held.delete(HELD)
  } else if (held.get(HELD) !== text) {
    held.set(HELD, text)
  }
}

export function seedExtras(doc: Y.Doc, canvas: Canvas) {
  if (holdsExtras(canvas.extras)) putExtras(doc, canvas)
}

function isInk(thing: Thing): thing is InkStroke {
  return 'points' in thing
}

function isEdge(thing: Thing): thing is CanvasEdge {
  return 'fromNode' in thing
}

function kindOf(thing: Thing): ThingKind {
  if (isInk(thing)) return 'ink'
  return isEdge(thing) ? 'edge' : 'node'
}

function fieldsOf(thing: Thing): Record<string, unknown> {
  if (!isInk(thing)) return { ...thing }
  return { ...thing, points: packed(thing.points) }
}

function same(one: unknown, other: unknown): boolean {
  if (one === other) return true
  if (!Array.isArray(one) || !Array.isArray(other)) return false

  return one.length === other.length && one.every((value, at) => value === other[at])
}

function put(plane: Y.Map<Y.Map<unknown>>, thing: Thing, at: number, z: number) {
  const fields = fieldsOf(thing)
  const held = plane.get(thing.id)

  if (!held) {
    const made = new Y.Map<unknown>()
    for (const [key, value] of Object.entries(fields)) made.set(key, shared(key, value))
    made.set(KIND, kindOf(thing))
    made.set(AT, at)
    made.set(Z, z)
    plane.set(thing.id, made)
    return
  }

  for (const [key, value] of Object.entries(fields)) {
    const current = held.get(key)
    if (key === WORDS && typeof value === 'string' && current instanceof Y.Text) {
      rewrite(current, value)
      continue
    }
    if (!same(current, value)) held.set(key, shared(key, value))
  }

  for (const key of [...held.keys()]) {
    if (ADDED.includes(key) || key in fields) continue
    held.delete(key)
  }

  if (held.get(AT) !== at) held.set(AT, at)
}

const WORDS = 'text'

function shared(key: string, value: unknown): unknown {
  return key === WORDS && typeof value === 'string' ? new Y.Text(value) : value
}

function rewrite(text: Y.Text, wanted: string) {
  const change = fold(text.toJSON(), wanted)
  if (!change) return
  if (change.to > change.from) text.delete(change.from, change.to - change.from)
  if (change.insert) text.insert(change.from, change.insert)
}

function nextPlace(plane: Y.Map<Y.Map<unknown>>): number {
  let highest = -1
  for (const record of plane.values()) {
    const z = record.get(Z)
    if (typeof z === 'number' && z > highest) highest = z
  }

  return highest + 1
}

function placeIn(plane: Y.Map<Y.Map<unknown>>, id: string): number | null {
  const z = plane.get(id)?.get(Z)
  return typeof z === 'number' ? z : null
}

interface Placing {
  id: string
  z: number
  record: Y.Map<unknown>
}

function under(one: Placing, other: Placing): boolean {
  if (one.z !== other.z) return one.z < other.z
  return one.id < other.id
}

function restack(plane: Y.Map<Y.Map<unknown>>, before: readonly Thing[], after: readonly Thing[]) {
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

  const middle = after.slice(head, after.length - tail)
  if (!middle.length) return

  const placed = (thing: Thing | undefined): Placing[] => {
    const record = thing && plane.get(thing.id)
    return thing && record ? [{ id: thing.id, z: placeOf(record), record }] : []
  }

  const [floor] = placed(after[head - 1])
  const [ceiling] = placed(after[after.length - tail])
  const places = middle.flatMap(placed)
  const inside = places.filter(
    (place) => (!floor || under(floor, place)) && (!ceiling || under(place, ceiling)),
  )

  const kept = standing(inside, under)
  if (kept.size === places.length) return
  const stays = new Set(inside.filter((_, index) => kept.has(index)))

  let low = floor?.z
  let waiting: Placing[] = []
  for (const place of places) {
    if (!stays.has(place)) {
      waiting.push(place)
    } else if (between(waiting, low, place.z)) {
      waiting = []
      low = place.z
    } else {
      waiting.push(place)
    }
  }

  for (const thing of after.slice(after.length - tail)) {
    const [place] = placed(thing)
    if (!place) continue
    if (between(waiting, low, place.z)) return
    waiting.push(place)
  }

  between(waiting, low, undefined)
}

function between(waiting: readonly Placing[], low?: number, high?: number): boolean {
  const count = waiting.length
  if (!count) return true

  const at = (one: number) => {
    if (low !== undefined && high !== undefined) {
      return low + ((high - low) * (one + 1)) / (count + 1)
    }
    if (low !== undefined) return low + one + 1
    return (high ?? count) - (count - one)
  }

  if (low !== undefined && high !== undefined) {
    let last = low
    for (let one = 0; one < count; one++) {
      const z = at(one)
      if (z <= last || z >= high) return false
      last = z
    }
  }

  waiting.forEach((place, one) => {
    place.z = at(one)
    place.record.set(Z, place.z)
  })
  return true
}

function things(canvas: Canvas): Map<string, Thing> {
  const out = new Map<string, Thing>()
  for (const thing of [...canvas.nodes, ...canvas.edges, ...canvas.ink]) out.set(thing.id, thing)
  return out
}

export function seedPlane(doc: Y.Doc, canvas: Canvas) {
  const plane = planeOf(doc)
  const buried = buriedOf(doc)
  let place = 0

  for (const thing of [...canvas.nodes, ...canvas.edges, ...canvas.ink]) {
    put(plane, thing, canvas.at[thing.id] ?? 0, place++)
  }

  for (const [id, when] of Object.entries(canvas.gone)) buried.set(id, when)
}

export function pushPlane(doc: Y.Doc, before: Canvas, after: Canvas) {
  const plane = planeOf(doc)
  const buried = buriedOf(doc)
  const was = things(before)
  const is = things(after)

  let place: number | null = null
  const placeFor = (id: string): number => {
    const held = placeIn(plane, id)
    if (held !== null) return held

    place = place === null ? nextPlace(plane) : place + 1
    return place
  }

  for (const [id, thing] of is) {
    if (was.get(id) === thing && plane.has(id)) continue
    put(plane, thing, after.at[id] ?? 0, placeFor(id))
  }

  for (const id of was.keys()) {
    if (!is.has(id)) plane.delete(id)
  }

  restack(plane, before.nodes, after.nodes)
  restack(plane, before.edges, after.edges)
  restack(plane, before.ink, after.ink)

  if (after.moved !== before.moved) {
    for (const [id, when] of Object.entries(after.moved ?? {})) {
      const record = plane.get(id)
      if (record && record.get(MOVED) !== when) record.set(MOVED, when)
    }
  }

  for (const [id, when] of Object.entries(after.gone)) {
    if (!is.has(id) && buried.get(id) !== when) buried.set(id, when)
  }

  if (after.extras !== before.extras) {
    const was = holdsExtras(before.extras) ? extrasText(before.extras) : null
    const is = holdsExtras(after.extras) ? extrasText(after.extras) : null
    if (was !== is) putExtras(doc, after)
  }

  if (buried.size) {
    for (const id of [...buried.keys()]) {
      if (is.has(id)) buried.delete(id)
    }
  }
}

function read(record: Y.Map<unknown>, nodes: ReadonlySet<string>): Thing | null {
  const fields = record.toJSON()

  switch (fields[KIND]) {
    case 'ink':
      return strokeOf({ ...fields, points: Array.isArray(fields.points) ? fields.points : [] })
    case 'edge':
      return edgeOf(fields, nodes)
    case 'node':
      return nodeOf(fields)
    default:
      return null
  }
}

function placeOf(record: Y.Map<unknown>): number {
  const z = record.get(Z)
  return typeof z === 'number' ? z : Number.MAX_SAFE_INTEGER
}

interface Placed<T extends Thing> {
  thing: T
  z: number
  id: string
}

function stacked<T extends Thing>(a: Placed<T>, b: Placed<T>): number {
  if (a.z !== b.z) return a.z - b.z
  return a.id < b.id ? -1 : 1
}

const NO_NODES: ReadonlySet<string> = new Set<string>()

export function readPlane(doc: Y.Doc, previous?: Canvas, changed?: ReadonlySet<string>): Canvas {
  const plane = planeOf(doc)
  const kept = previous && changed ? things(previous) : null
  const held = (id: string) => (changed?.has(id) ? undefined : kept?.get(id))

  const nodes: Placed<CanvasNode>[] = []
  const later: { record: Y.Map<unknown>; z: number; id: string }[] = []
  const at: Record<string, number> = {}
  const moved: Record<string, number> = {}

  for (const [id, record] of plane) {
    const z = placeOf(record)
    const when = record.get(AT)
    at[id] = typeof when === 'number' ? when : 0
    const shifted = record.get(MOVED)
    if (typeof shifted === 'number') moved[id] = shifted

    if (record.get(KIND) !== 'node') {
      later.push({ record, z, id })
      continue
    }

    const already = held(id)
    const node = already && !isInk(already) && !isEdge(already) ? already : read(record, NO_NODES)
    if (node && !isInk(node) && !isEdge(node)) nodes.push({ thing: node, z, id })
  }

  nodes.sort(stacked)
  const there = new Set(nodes.map((one) => one.id))

  const edges: Placed<CanvasEdge>[] = []
  const ink: Placed<InkStroke>[] = []

  for (const { record, z, id } of later) {
    const thing = held(id) ?? read(record, there)
    if (!thing) continue

    if (isInk(thing)) ink.push({ thing, z, id })
    else if (isEdge(thing) && there.has(thing.fromNode) && there.has(thing.toNode)) {
      edges.push({ thing, z, id })
    }
  }

  edges.sort(stacked)
  ink.sort(stacked)

  const gone: Record<string, number> = {}
  for (const [id, when] of buriedOf(doc)) {
    if (typeof when === 'number') gone[id] = when
  }

  const text = doc.getMap<string>(EXTRAS).get(HELD)
  const mine = previous?.extras
  const extras =
    text !== undefined && holdsExtras(mine) && extrasText(mine) === text ? mine : extrasRead(text)

  return {
    nodes: nodes.map((one) => one.thing),
    edges: edges.map((one) => one.thing),
    ink: ink.map((one) => one.thing),
    at,
    gone,
    ...(Object.keys(moved).length ? { moved } : {}),
    ...(holdsExtras(extras) ? { extras } : {}),
  }
}

export function planeIsEmpty(doc: Y.Doc): boolean {
  return planeOf(doc).size === 0 && buriedOf(doc).size === 0
}
