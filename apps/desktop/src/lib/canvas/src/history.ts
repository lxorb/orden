import type { Canvas } from '@orden/markdown/canvas'

export const KEPT = 60

export class CanvasHistory {
  private past: Canvas[] = []
  private future: Canvas[] = []

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  record(before: Canvas) {
    this.past.push(before)
    if (this.past.length > KEPT) this.past.shift()
    this.future = []
  }

  undo(current: Canvas): Canvas | null {
    const before = this.past.pop()
    if (!before) return null

    this.future.unshift(current)
    return before
  }

  drop(): Canvas | null {
    return this.past.pop() ?? null
  }

  redo(current: Canvas): Canvas | null {
    const after = this.future.shift()
    if (!after) return null

    this.past.push(current)
    return after
  }

  clear() {
    this.past = []
    this.future = []
  }

  carry(ours: Canvas, theirs: Canvas) {
    if (!this.past.length && !this.future.length) return
    const change = changeBetween(ours, theirs)
    if (!change) return

    this.past = this.past.map(change)
    this.future = this.future.map(change)
  }
}

interface Thing {
  id: string
}

const FIELDS = ['icon', 'iconColor', 'extras'] as const

function same(one: unknown, other: unknown): boolean {
  return one === other || JSON.stringify(one) === JSON.stringify(other)
}

function listChange(ours: readonly Thing[], theirs: readonly Thing[]): Map<string, Thing | null> {
  const mine = new Map(ours.map((one) => [one.id, one]))
  const change = new Map<string, Thing | null>()

  for (const one of theirs) {
    const held = mine.get(one.id)
    mine.delete(one.id)
    if (held === undefined || !same(held, one)) change.set(one.id, one)
  }
  for (const id of mine.keys()) change.set(id, null)

  return change
}

function changedList<T extends Thing>(held: readonly T[], change: Map<string, Thing | null>): T[] {
  if (!change.size) return held.slice()

  const seen = new Set<string>()
  const out: T[] = []
  for (const one of held) {
    seen.add(one.id)
    const now = change.has(one.id) ? change.get(one.id) : one
    if (now) out.push(now as T)
  }
  for (const [id, one] of change) if (one && !seen.has(id)) out.push(one as T)

  return out
}

function changeBetween(ours: Canvas, theirs: Canvas): ((held: Canvas) => Canvas) | null {
  const nodes = listChange(ours.nodes, theirs.nodes)
  const edges = listChange(ours.edges, theirs.edges)
  const ink = listChange(ours.ink, theirs.ink)
  const fields = FIELDS.filter((name) => !same(ours[name], theirs[name]))
  if (!nodes.size && !edges.size && !ink.size && !fields.length) return null

  return (held) => {
    const out: Canvas = {
      ...held,
      nodes: changedList(held.nodes, nodes),
      edges: changedList(held.edges, edges),
      ink: changedList(held.ink, ink),
    }
    const cards = new Set(out.nodes.map((node) => node.id))
    out.edges = out.edges.filter((edge) => cards.has(edge.fromNode) && cards.has(edge.toNode))

    for (const name of fields) Object.assign(out, { [name]: theirs[name] })
    if (out.extras === undefined) delete out.extras

    return out
  }
}
