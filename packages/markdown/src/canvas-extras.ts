/** What a canvas file holds that Orden does not read, kept through what Orden writes
 *  back over it (#501).
 *
 *  `readCanvas` reads what JSON Canvas and Orden's own `nib` key define and leaves the
 *  rest out (canvas.ts). Leaving it out of what a surface draws is right; leaving it out
 *  of what is written back is somebody's work gone: a node of a type the spec does not
 *  name - Obsidian's plugins add their own, `excalidraw` among them - and every edge
 *  that ends at one, a field the spec does not list on a node (Advanced Canvas's
 *  `styleAttributes`), a key beside `nodes` and `edges` (`metadata`), a key under `nib`
 *  a newer Orden wrote. A merge of two copies is the one road that reads both whole files
 *  and writes one back without anybody having asked for an edit, so it carries them:
 *  the union of both sides', each unknown thing by its id.
 *
 *  Symmetric, like the merge it rides along with: two copies put together either way
 *  round come out as the same file. */

import { readCanvas } from './canvas'

/** A node's fields that canvas.ts reads and writes, whichever kind it is. */
const NODE_FIELDS = new Set([
  'id',
  'type',
  'x',
  'y',
  'width',
  'height',
  'color',
  'text',
  'file',
  'subpath',
  'url',
  'label',
  'background',
  'backgroundStyle',
])

const EDGE_FIELDS = new Set([
  'id',
  'fromNode',
  'fromSide',
  'fromEnd',
  'toNode',
  'toSide',
  'toEnd',
  'color',
  'label',
])

const TOP_FIELDS = new Set(['nodes', 'edges', 'nib'])

const NIB_FIELDS = new Set([
  'version',
  'icon',
  'iconColor',
  'pages',
  'ink',
  'shapes',
  'order',
  'words',
  'locked',
  'at',
  'gone',
])

type Fields = Record<string, unknown>

/** What one file holds that is not read. */
export interface Extras {
  /** Keys beside `nodes`, `edges` and `nib`. */
  top: Fields
  /** Keys under `nib` this build does not know. */
  nib: Fields
  /** Nodes that do not read as one, whole, by id. */
  nodes: Map<string, Fields>
  /** Edges that do not read as one - most of them ending at such a node - by id. */
  edges: Map<string, Fields>
  /** Fields a node or an edge that does read carries beside the ones read, by its id. */
  fields: Map<string, Fields>
}

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function idOf(value: Fields): string | null {
  return typeof value.id === 'string' && value.id ? value.id : null
}

function beyond(value: Fields, known: ReadonlySet<string>): Fields | null {
  let out: Fields | null = null
  for (const [key, held] of Object.entries(value)) {
    if (known.has(key)) continue
    out ??= {}
    out[key] = held
  }
  return out
}

function none(): Extras {
  return { top: {}, nib: {}, nodes: new Map(), edges: new Map(), fields: new Map() }
}

/** What the file `text` holds that `readCanvas` leaves out. Nothing for text that is not
 *  a canvas at all. */
export function extrasOf(text: string): Extras {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return none()
  }
  if (!isRecord(parsed)) return none()

  const out = none()
  const canvas = readCanvas(text)
  const nodes = new Set(canvas.nodes.map((node) => node.id))
  const edges = new Set(canvas.edges.map((edge) => edge.id))

  for (const [key, held] of Object.entries(parsed)) {
    if (!TOP_FIELDS.has(key)) out.top[key] = held
  }
  if (isRecord(parsed.nib)) out.nib = beyond(parsed.nib, NIB_FIELDS) ?? {}

  const each = (list: unknown, read: ReadonlySet<string>, known: ReadonlySet<string>) => {
    const unread = new Map<string, Fields>()
    if (!Array.isArray(list)) return unread
    for (const entry of list) {
      if (!isRecord(entry)) continue
      const id = idOf(entry)
      if (id === null) continue
      if (!read.has(id)) {
        if (!unread.has(id)) unread.set(id, entry)
        continue
      }
      const more = beyond(entry, known)
      if (more && !out.fields.has(id)) out.fields.set(id, more)
    }
    return unread
  }
  out.nodes = each(parsed.nodes, nodes, NODE_FIELDS)
  out.edges = each(parsed.edges, edges, EDGE_FIELDS)
  return out
}

/** Whether a file holds anything unread at all. */
export function holdsExtras(extras: Extras): boolean {
  return (
    Object.keys(extras.top).length > 0 ||
    Object.keys(extras.nib).length > 0 ||
    extras.nodes.size > 0 ||
    extras.edges.size > 0 ||
    extras.fields.size > 0
  )
}

/** The one of two values to keep where both sides hold something different: the one
 *  whose written form sorts first, which is how `later` in canvas-merge.ts breaks a tie,
 *  so both devices reach the same answer. */
function either(ours: unknown, theirs: unknown): unknown {
  if (ours === undefined) return theirs
  if (theirs === undefined) return ours
  return JSON.stringify(ours) <= JSON.stringify(theirs) ? ours : theirs
}

function unionOf(ours: Fields, theirs: Fields): Fields {
  const out: Fields = {}
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    out[key] = either(ours[key], theirs[key])
  }
  return out
}

function unionBy(ours: Map<string, Fields>, theirs: Map<string, Fields>): Map<string, Fields> {
  const out = new Map<string, Fields>()
  for (const id of new Set([...ours.keys(), ...theirs.keys()])) {
    out.set(id, either(ours.get(id), theirs.get(id)) as Fields)
  }
  return out
}

/** Two files' extras as one: everything either holds, by id. */
export function mergedExtras(ours: Extras, theirs: Extras): Extras {
  const fields = new Map<string, Fields>()
  for (const id of new Set([...ours.fields.keys(), ...theirs.fields.keys()])) {
    fields.set(id, unionOf(ours.fields.get(id) ?? {}, theirs.fields.get(id) ?? {}))
  }
  return {
    top: unionOf(ours.top, theirs.top),
    nib: unionOf(ours.nib, theirs.nib),
    nodes: unionBy(ours.nodes, theirs.nodes),
    edges: unionBy(ours.edges, theirs.edges),
    fields,
  }
}

/** The file `text`, as `writeCanvas` wrote it, with `extras` put back into it. The text
 *  itself where there is nothing to put back, so a canvas with nothing unread in it is
 *  written exactly as it always was.
 *
 *  A node or an edge that is not in the file any more takes its own fields with it; one
 *  that does not read is kept while it is not in the file as one that does, and an edge
 *  that does not read is kept while both its ends are in the file. Unread nodes and
 *  edges go after the ones that read, in the order they came. */
export function withExtras(text: string, extras: Extras): string {
  if (!holdsExtras(extras)) return text

  const file = JSON.parse(text) as Fields
  const nodes = Array.isArray(file.nodes) ? (file.nodes as Fields[]) : []
  const edges = Array.isArray(file.edges) ? (file.edges as Fields[]) : []
  const placed = new Set(nodes.map((node) => idOf(node)))

  for (const node of nodes) Object.assign(node, extras.fields.get(idOf(node) ?? '') ?? {})
  for (const [id, node] of extras.nodes) {
    if (placed.has(id)) continue
    nodes.push(node)
    placed.add(id)
  }

  const joined = new Set(edges.map((edge) => idOf(edge)))
  for (const edge of edges) Object.assign(edge, extras.fields.get(idOf(edge) ?? '') ?? {})
  for (const [id, edge] of extras.edges) {
    if (joined.has(id)) continue
    if (!placed.has(edge.fromNode as string) || !placed.has(edge.toNode as string)) continue
    edges.push(edge)
    joined.add(id)
  }

  file.nodes = nodes
  file.edges = edges
  if (Object.keys(extras.nib).length) {
    file.nib = { ...(isRecord(file.nib) ? file.nib : {}), ...extras.nib }
  }
  for (const [key, held] of Object.entries(extras.top)) {
    if (!TOP_FIELDS.has(key)) file[key] = held
  }

  return `${JSON.stringify(file, null, '\t')}\n`
}
