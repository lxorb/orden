import { holdsExtras, mergedExtras } from '@orden/markdown/canvas-extras'
import type { Canvas, Thing } from '@orden/markdown/canvas'
import { diverge, REWRITTEN, type Times, type Verdict } from './diverge'
import { edits } from './diff'
import type { Whose } from './merge3'

export interface PlaneOverlap {
  id: string
  field: string
  newer: Whose
  asks: boolean
}

export interface PlaneDivergence {
  verdict: Verdict
  overlaps: readonly PlaneOverlap[]
  resolution: Canvas | null
}

const WORDS: readonly string[] = ['text', 'label']

type Fields = Record<string, unknown>

function thingsOf(canvas: Canvas): Map<string, Thing> {
  const out = new Map<string, Thing>()
  for (const thing of [...canvas.nodes, ...canvas.edges, ...canvas.ink]) out.set(thing.id, thing)
  return out
}

function fieldsOf(thing: Thing | undefined): Fields {
  return thing ? { ...thing } : {}
}

function same(one: unknown, other: unknown): boolean {
  return one === other || JSON.stringify(one) === JSON.stringify(other)
}

function written(before: string, after: string): number {
  return edits(before, after, 'semantic').reduce(
    (sum, edit) => sum + edit.insert.length + (edit.to - edit.from),
    0,
  )
}

function withFields(thing: Thing, taken: Fields): Thing {
  const fields = Object.entries({ ...thing, ...taken }).filter(([, value]) => value !== undefined)
  return Object.fromEntries(fields) as unknown as Thing
}

interface Outcome {
  thing: Thing | null
  overlaps: PlaneOverlap[]
}

function mergedObject(
  id: string,
  base: Thing,
  local: Thing,
  remote: Thing,
  times: Times,
  newer: Whose,
): Outcome {
  const [b, l, r] = [fieldsOf(base), fieldsOf(local), fieldsOf(remote)]
  const winner = newer === 'local' ? local : remote
  const overlaps: PlaneOverlap[] = []
  const taken: Fields = {}

  for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    const mine = !same(b[key], l[key])
    const theirs = !same(b[key], r[key])
    if (!mine && !theirs) continue
    if (mine && !theirs) {
      taken[key] = l[key]
      continue
    }
    if (!mine && theirs) {
      taken[key] = r[key]
      continue
    }
    if (same(l[key], r[key])) continue

    const [was, ours, other] = [b[key], l[key], r[key]]
    if (WORDS.includes(key) && typeof ours === 'string' && typeof other === 'string') {
      const text = diverge(typeof was === 'string' ? was : '', ours, other, times)
      overlaps.push({ id, field: key, newer, asks: text.verdict === 'diverged' })
      if (text.resolution !== null) taken[key] = text.resolution
      continue
    }

    overlaps.push({ id, field: key, newer, asks: false })
    taken[key] = newer === 'local' ? ours : other
  }

  return { thing: withFields(winner, taken), overlaps }
}

function deletedOnOneSide(
  id: string,
  base: Thing,
  kept: Thing,
  keptBy: Whose,
  newer: Whose,
): Outcome {
  if (same(fieldsOf(base), fieldsOf(kept))) return { thing: null, overlaps: [] }

  const b = fieldsOf(base)
  const k = fieldsOf(kept)
  const rewritten = WORDS.reduce((sum, key) => {
    const was = b[key]
    const now = k[key]
    return typeof was === 'string' && typeof now === 'string' ? sum + written(was, now) : sum
  }, 0)

  const asks = rewritten > REWRITTEN
  return {
    thing: newer === keptBy ? kept : null,
    overlaps: [{ id, field: 'deleted', newer, asks }],
  }
}

export function divergePlane(
  base: Canvas,
  local: Canvas,
  remote: Canvas,
  times: Times,
): PlaneDivergence {
  const newer: Whose = times.local > times.remote ? 'local' : 'remote'
  const [b, l, r] = [thingsOf(base), thingsOf(local), thingsOf(remote)]
  const overlaps: PlaneOverlap[] = []
  const settled = new Map<string, Thing | null>()

  const outcomeOf = (id: string): Outcome => {
    const [was, mine, theirs] = [b.get(id), l.get(id), r.get(id)]
    if (!was) return { thing: mine ?? theirs ?? null, overlaps: [] }
    if (mine && theirs) return mergedObject(id, was, mine, theirs, times, newer)
    if (mine) return deletedOnOneSide(id, was, mine, 'local', newer)
    if (theirs) return deletedOnOneSide(id, was, theirs, 'remote', newer)
    return { thing: null, overlaps: [] }
  }

  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const outcome = outcomeOf(id)
    settled.set(id, outcome.thing)
    overlaps.push(...outcome.overlaps)
  }

  const asks = overlaps.some((overlap) => overlap.asks)
  const verdict: Verdict = asks ? 'diverged' : overlaps.length ? 'minor' : 'clean'
  return {
    verdict,
    overlaps,
    resolution: asks ? null : resolvedPlane(base, local, remote, settled, newer),
  }
}

function resolvedPlane(
  base: Canvas,
  local: Canvas,
  remote: Canvas,
  settled: ReadonlyMap<string, Thing | null>,
  newer: Whose,
): Canvas {
  const order = [
    ...[...local.nodes, ...local.edges, ...local.ink].map((thing) => thing.id),
    ...[...remote.nodes, ...remote.edges, ...remote.ink].map((thing) => thing.id),
  ]
  const nodes: Canvas['nodes'] = []
  const edgeList: Canvas['edges'] = []
  const ink: Canvas['ink'] = []
  const placed = new Set<string>()

  for (const id of order) {
    const thing = settled.get(id)
    if (!thing || placed.has(id)) continue
    placed.add(id)
    if ('points' in thing) ink.push(thing)
    else if ('fromNode' in thing) edgeList.push(thing)
    else nodes.push(thing)
  }

  const ends = new Set(nodes.map((node) => node.id))
  const edgesKept = edgeList.filter((edge) => ends.has(edge.fromNode) && ends.has(edge.toNode))

  const at: Record<string, number> = {}
  for (const times of [local.at, remote.at]) {
    for (const [id, when] of Object.entries(times)) {
      if (placed.has(id)) at[id] = Math.max(at[id] ?? 0, when)
    }
  }

  const gone: Record<string, number> = {}
  for (const tombstones of [base.gone, local.gone, remote.gone]) {
    for (const [id, when] of Object.entries(tombstones)) {
      if (!placed.has(id)) gone[id] = Math.max(gone[id] ?? 0, when)
    }
  }

  const iconSide = (key: 'icon' | 'iconColor') => {
    const mine = !same(base[key], local[key])
    const theirs = !same(base[key], remote[key])
    if (mine && theirs) return newer === 'local' ? local[key] : remote[key]
    return mine ? local[key] : remote[key]
  }

  const moved: Record<string, number> = {}
  for (const times of [local.moved, remote.moved]) {
    for (const [id, when] of Object.entries(times ?? {})) {
      if (placed.has(id)) moved[id] = Math.max(moved[id] ?? 0, when)
    }
  }

  const out: Canvas = { nodes, edges: edgesKept, ink, at, gone }
  if (Object.keys(moved).length) out.moved = moved
  const icon = iconSide('icon')
  const iconColor = iconSide('iconColor')
  if (icon !== undefined) out.icon = icon
  if (iconColor !== undefined) out.iconColor = iconColor
  if (holdsExtras(local.extras) || holdsExtras(remote.extras)) {
    out.extras = mergedExtras(local.extras, remote.extras)
  }
  return out
}
