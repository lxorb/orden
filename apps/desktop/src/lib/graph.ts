/** The space as a graph, and the neighbourhood of one note in it.
 *
 *  A node per note, an edge per link between two notes. An edge answers "these
 *  two are connected", which is the question a picture of a space is looked at
 *  for, and it is what lets one edge stand for a pair of notes that link both
 *  ways. It remembers which end reached for which all the same, because that is
 *  what an arrowhead says and the only thing in the picture that can say it.
 *
 *  Built from what the link index already holds rather than from the notes
 *  again: the index hands over its notes and the resolver it caches, so a graph
 *  of two thousand notes costs one walk over their links and no second index.
 *
 *  Pure, so the shape of a graph is a thing tests can state. Where the nodes end
 *  up is `graph-layout.ts`. */

import type { LinkKind } from '@nib/markdown/links'
import type { ScannedNote } from './scan-note'

export interface GraphNode {
  /** A note's path relative to the space, or `?name` for a target the space
   *  holds no note for. Stable across a rebuild, which is what lets the view
   *  keep saying "this one" while the index changes underneath it. */
  id: string
  /** What the label says: the note's name, or the target as it was written. */
  name: string
  /** The note to open, or null for a target nothing answers yet. */
  path: string | null
  /** How many edges touch it, which is what its size says. */
  degree: number
  /** The tags the note carries, folded and without the hash, which is what a
   *  filter and a colour group ask about. Empty for a note the space does not
   *  hold, since there is nothing to read them out of. */
  tags: string[]
}

/** One connection: the note the link was written in, and the note it named.
 *
 *  Undirected for the layout's purposes - a spring pulls both ways - but the two
 *  ends are not interchangeable, and an arrowhead is the only thing in the picture
 *  that says which note reached for which. `both` is a pair that link each way,
 *  drawn with a head at each end. */
export interface GraphEdge {
  a: number
  b: number
  both: boolean
}

export interface NoteGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** Which note a link in a given note points at, or null for one that points
 *  nowhere. The link index's own answer, cached there. */
export type Resolve = (from: string, link: { kind: LinkKind; target: string }) => string | null

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i
const CANVAS = /\.canvas$/i
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/

/** What marks an id as a target nothing answers. A path never starts with it,
 *  so the two kinds of node cannot collide. */
const MISSING = '?'

/** Whether a target names something the space draws as a node.
 *
 *  `![[shot.png]]` brings a picture into a note; it is not a link to one, and a
 *  hollow node called `shot.png` would be a lie about the space. A canvas is the
 *  other way round: the index reads one as a note, so it is already a node, and a
 *  note writing `[[Board.canvas]]` is reaching for it exactly as it would reach
 *  for a note. Without this the canvas sat in the picture as an island. */
function namesNote(target: string): boolean {
  const last = target.split('/').pop() ?? target
  return !EXTENSION.test(last) || MARKDOWN.test(last) || CANVAS.test(last)
}

/** The node a target with nowhere to go gets, made once however many notes
 *  write it. Keyed by the name it asks for, folded, so `[[plan]]` and `[[Plan]]`
 *  are the one note that is not there rather than two. */
function missing(nodes: GraphNode[], at: Map<string, number>, target: string): number {
  const name = (target.replace(/\\/g, '/').split('/').pop() ?? target).replace(MARKDOWN, '')
  const id = MISSING + name.toLowerCase()

  const held = at.get(id)
  if (held !== undefined) return held

  at.set(id, nodes.length)
  nodes.push({ id, name, path: null, degree: 0, tags: [] })
  return nodes.length - 1
}

/** Every note and every link between two of them. */
export function buildGraph(notes: readonly ScannedNote[], resolve: Resolve): NoteGraph {
  const nodes: GraphNode[] = notes.map((note) => ({
    id: note.path,
    name: note.name,
    path: note.path,
    degree: 0,
    tags: note.tags,
  }))
  const at = new Map(nodes.map((node, index) => [node.id, index]))
  const edges: GraphEdge[] = []
  // A pair of notes gets one edge however often they link to each other, and
  // which edge that is, so the second direction can add its arrowhead to it.
  const drawn = new Map<string, number>()

  for (const note of notes) {
    const from = at.get(note.path)
    if (from === undefined) continue

    for (const link of note.links) {
      if (!link.target || !namesNote(link.target)) continue

      const found = resolve(note.path, link)
      const to = found === null ? missing(nodes, at, link.target) : at.get(found)
      // A link into the note it is written in joins nothing.
      if (to === undefined || to === from) continue

      const pair = from < to ? `${from} ${to}` : `${to} ${from}`
      const already = drawn.get(pair)
      if (already !== undefined) {
        // The two notes are already joined. A link the other way adds nothing to
        // the connection and one arrowhead to the drawing of it.
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

function count(nodes: GraphNode[], index: number) {
  const node = nodes[index]
  if (node) node.degree++
}

/** Who each node is joined to, as a list per node. */
function adjacency(graph: NoteGraph): number[][] {
  const near: number[][] = graph.nodes.map(() => [])

  for (const edge of graph.edges) {
    near[edge.a]?.push(edge.b)
    near[edge.b]?.push(edge.a)
  }

  return near
}

/** The note at `centre` and everything within `depth` links of it, as a graph of
 *  its own. Empty when the space holds no such note, which is what a window with
 *  no note open shows.
 *
 *  The centre comes first, and the rest in the order they were reached, so a
 *  depth of two lists the immediate neighbours before their neighbours. Degrees
 *  are counted within the slice: a node's size says how connected it is in the
 *  picture being looked at, not elsewhere. */
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

  const kept = [...reached]
  const place = new Map(kept.map((index, order) => [index, order]))
  const nodes = kept
    .map((index) => graph.nodes[index])
    .filter((node): node is GraphNode => node !== undefined)
    .map((node) => ({ ...node, degree: 0 }))

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
