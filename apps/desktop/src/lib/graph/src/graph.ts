import { embedKind, foldName, type LinkKind } from '@orden/markdown/links'
import type { ScannedNote } from '@orden/scan/note'

export interface GraphNode {
  id: string
  name: string
  path: string | null
  degree: number
  tags: string[]
  attachment?: true
}

interface GraphEdge {
  a: number
  b: number
  both: boolean
}

export interface NoteGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type Resolve = (from: string, link: { kind: LinkKind; target: string }) => string | null

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i
const CANVAS = /\.canvas$/i
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/

const MISSING = '?'
const EMBEDDED = '!'

function namesNote(target: string): boolean {
  const last = target.split('/').pop() ?? target
  return !EXTENSION.test(last) || MARKDOWN.test(last) || CANVAS.test(last)
}

function namesFile(link: { target: string; embed?: boolean }): boolean {
  if (!link.embed) return false

  const kind = embedKind(link.target)
  return kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'pdf'
}

function embedded(nodes: GraphNode[], at: Map<string, number>, target: string): number {
  const name = target.replace(/\\/g, '/').split('/').pop() ?? target
  const id = EMBEDDED + foldName(name)

  const held = at.get(id)
  if (held !== undefined) return held

  at.set(id, nodes.length)
  nodes.push({ id, name, path: null, degree: 0, tags: [], attachment: true })
  return nodes.length - 1
}

function missing(nodes: GraphNode[], at: Map<string, number>, target: string): number {
  const name = (target.replace(/\\/g, '/').split('/').pop() ?? target).replace(MARKDOWN, '')
  const id = MISSING + foldName(name)

  const held = at.get(id)
  if (held !== undefined) return held

  at.set(id, nodes.length)
  nodes.push({ id, name, path: null, degree: 0, tags: [] })
  return nodes.length - 1
}

export interface GraphOptions {
  attachments?: boolean
}

export function buildGraph(
  notes: readonly ScannedNote[],
  resolve: Resolve,
  options: GraphOptions = {},
): NoteGraph {
  const shown = notes.filter((note) => !note.path.split('/').some((part) => part.startsWith('.')))
  const nodes: GraphNode[] = shown.map((note) => ({
    id: note.path,
    name: note.name,
    path: note.path,
    degree: 0,
    tags: note.tags,
  }))
  const at = new Map(nodes.map((node, index) => [node.id, index]))
  const edges: GraphEdge[] = []
  const drawn = new Map<string, number>()

  for (const note of shown) {
    const from = at.get(note.path)
    if (from === undefined) continue

    for (const link of note.links) {
      if (!link.target) continue

      const file = options.attachments && namesFile(link)
      if (!file && !namesNote(link.target)) continue

      const found = file ? null : resolve(note.path, link)
      const to = file
        ? embedded(nodes, at, link.target)
        : found === null
          ? missing(nodes, at, link.target)
          : at.get(found)
      if (to === undefined || to === from) continue

      const pair = from < to ? `${from} ${to}` : `${to} ${from}`
      const already = drawn.get(pair)
      if (already !== undefined) {
        const edge = edges[already]
        if (edge && edge.a !== from) edge.both = true
        continue
      }

      drawn.set(pair, edges.length)
      edges.push({ a: from, b: to, both: false })
      count(nodes, from)
      count(nodes, to)
    }
  }

  return { nodes, edges }
}

const WORTH_A_GRAPH = 5

export function worthAGraph(graph: NoteGraph, enough = WORTH_A_GRAPH): boolean {
  const joined = new Set<number>()
  for (const edge of graph.edges) {
    if (graph.nodes[edge.a]?.path == null || graph.nodes[edge.b]?.path == null) continue
    joined.add(edge.a)
    joined.add(edge.b)
    if (joined.size >= enough) return true
  }
  return false
}

function count(nodes: GraphNode[], index: number) {
  const node = nodes[index]
  if (node) node.degree++
}

export function without(graph: NoteGraph, excluded: readonly string[]): NoteGraph {
  if (!excluded.length) return graph

  const left = (id: string) => excluded.some((one) => id === one || id.startsWith(`${one}/`))

  const dropped = new Set<number>()
  for (const [at, node] of graph.nodes.entries()) {
    if (node.path !== null && left(node.id)) dropped.add(at)
  }

  if (!dropped.size) return graph

  const asked = new Set<number>()
  for (const edge of graph.edges) {
    if (dropped.has(edge.a) || dropped.has(edge.b)) continue
    asked.add(edge.a)
    asked.add(edge.b)
  }

  for (const [at, node] of graph.nodes.entries()) {
    if (node.path === null && !asked.has(at)) dropped.add(at)
  }

  return sliced(
    graph,
    [...graph.nodes.keys()].filter((at) => !dropped.has(at)),
  )
}

export function sliced(graph: NoteGraph, kept: Iterable<number>): NoteGraph {
  const place = new Map<number, number>()
  const nodes: GraphNode[] = []
  for (const at of kept) {
    const node = graph.nodes[at]
    if (!node) continue

    place.set(at, nodes.length)
    nodes.push({ ...node, degree: 0 })
  }

  const edges: GraphEdge[] = []
  for (const edge of graph.edges) {
    const a = place.get(edge.a)
    const b = place.get(edge.b)
    if (a === undefined || b === undefined) continue

    edges.push({ a, b, both: edge.both })
    count(nodes, a)
    count(nodes, b)
  }

  return { nodes, edges }
}
