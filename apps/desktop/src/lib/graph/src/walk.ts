import { type NoteGraph, sliced } from './graph'

function mixed(into: number, word: string): number {
  let hash = into
  for (let at = 0; at < word.length; at++) {
    hash ^= word.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

function counted(into: number, value: number): number {
  let hash = Math.imul(into ^ (value & 0xffff), 0x01000193)
  hash = Math.imul(hash ^ (value >>> 16), 0x01000193)

  return hash >>> 0
}

const signatures = new WeakMap<NoteGraph, number>()

export function signature(graph: NoteGraph): number {
  const held = signatures.get(graph)
  if (held !== undefined) return held

  const { nodes, edges } = graph
  let hash = counted(counted(0x811c9dc5, nodes.length), edges.length)
  for (const node of nodes) hash = mixed(hash, node.id)
  for (const edge of edges) hash = counted(counted(hash, edge.a), edge.b)

  signatures.set(graph, hash)
  return hash
}

const joined = new WeakMap<NoteGraph, readonly (readonly number[])[]>()

export function neighbours(graph: NoteGraph, node: number): readonly number[] {
  let near = joined.get(graph)
  if (!near) {
    near = adjacency(graph)
    joined.set(graph, near)
  }

  return near[node] ?? []
}

function adjacency(graph: NoteGraph): number[][] {
  const near: number[][] = graph.nodes.map(() => [])

  for (const edge of graph.edges) {
    near[edge.a]?.push(edge.b)
    near[edge.b]?.push(edge.a)
  }

  return near
}

export function neighbourhood(graph: NoteGraph, centre: string, depth: number): NoteGraph {
  const from = graph.nodes.findIndex((node) => node.id === centre)
  if (from === -1) return { nodes: [], edges: [] }

  const near = adjacency(graph)
  const reached = new Set([from])
  let ring = [from]

  for (let step = 0; step < depth; step++) {
    const next: number[] = []

    for (const one of ring) {
      for (const other of near[one] ?? []) {
        if (reached.has(other)) continue
        reached.add(other)
        next.push(other)
      }
    }

    ring = next
  }

  return sliced(graph, reached)
}
