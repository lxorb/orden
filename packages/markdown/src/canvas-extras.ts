/** What a canvas file holds that Orden does not read, kept through what Orden writes
 *  back over it (#501, #780).
 *
 *  `readCanvas` reads what JSON Canvas and Orden's own `nib` key define and leaves the
 *  rest out (canvas.ts). Leaving it out of what a surface draws is right; leaving it out
 *  of what is written back is somebody's work gone: a node of a type the spec does not
 *  name - Obsidian's plugins add their own, `excalidraw` among them - and every edge
 *  that ends at one, a field the spec does not list on a node (Advanced Canvas's
 *  `styleAttributes`), a key beside `nodes` and `edges` (`metadata`), a key under `nib`
 *  a newer Orden wrote. So `readCanvas` keeps them on the canvas it reads (`extras`),
 *  every edit of a canvas carries them along as it carries everything it did not touch,
 *  and `writeCanvas` puts them back: an edit on the plane, a merge of two copies, a
 *  room's settle (`readPlane` in @nib/rooms keeps them in the room), an agent's edit.
 *  A merge takes everything either side holds, each unknown thing by its id.
 *
 *  Which side's version of one of them a merge keeps, and whether one that is gone
 *  stays gone (#781): nothing in such a thing says when it changed, Orden never changes
 *  one itself - another app does, in the file - and no clock reaches every place a
 *  canvas is read and written. So the file counts. Every write records each such
 *  thing's fingerprint and a generation (`nib.outside`); a read that finds one whose
 *  fingerprint differs, or one new beside the record, counts it a generation on, and
 *  one the record names that is not there is buried at the next generation. A merge
 *  keeps the higher generation, so the copy another app changed wins over a copy that
 *  only carried the old one, and a burial wins over an older version; the next write
 *  records the generation, so a copy merged and written still beats a stale third one.
 *  Two copies changed apart from the same generation tie, and the tie is broken as
 *  `later` in canvas-merge.ts breaks one.
 *
 *  Symmetric, like the merge it rides along with: two copies put together either way
 *  round come out as the same file. */

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
  'outside',
])

/** The key under `nib` holding the record of what was unread when it was written. */
const RECORD = 'outside'

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
  /** Each unread thing's generation, by `named` name; see the top of this file. */
  generations: Map<string, number>
  /** What was thrown away, and at which generation, by name. */
  buried: Map<string, number>
}

/** One unread thing's name among all of them: what it is, and its id or key. */
type Kind = 'node' | 'edge' | 'field' | 'top' | 'nib'

function named(kind: Kind, id: string): string {
  return `${kind}:${id}`
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
  return {
    top: {},
    nib: {},
    nodes: new Map(),
    edges: new Map(),
    fields: new Map(),
    generations: new Map(),
    buried: new Map(),
  }
}

/** JSON with every object's keys sorted, so another app writing the same thing in
 *  another order writes the same fingerprint. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** A short fingerprint of one thing: FNV-1a over its canonical JSON. */
function fingerprint(value: unknown): string {
  let hash = 0x811c9dc5
  const text = canonical(value)
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** Every unread thing, by its name. */
function everyOf(extras: Extras): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [key, held] of Object.entries(extras.top)) out.set(named('top', key), held)
  for (const [key, held] of Object.entries(extras.nib)) out.set(named('nib', key), held)
  for (const [id, held] of extras.nodes) out.set(named('node', id), held)
  for (const [id, held] of extras.edges) out.set(named('edge', id), held)
  for (const [id, held] of extras.fields) out.set(named('field', id), held)
  return out
}

/** One entry of the record: a fingerprint and its generation, `print.generation`, or a
 *  burial, `~generation`. */
function entryOf(entry: unknown): { print: string | null; generation: number } | null {
  if (typeof entry !== 'string') return null
  const buried = entry.startsWith('~')
  const at = entry.lastIndexOf('.')
  const generation = Number(buried ? entry.slice(1) : entry.slice(at + 1))
  if (!Number.isInteger(generation) || generation < 0) return null
  if (buried) return { print: null, generation }
  return at > 0 ? { print: entry.slice(0, at), generation } : null
}

/** Nothing unread. */
export function noExtras(): Extras {
  return none()
}

/** What a file's parsed JSON holds that was not read, given the ids of the nodes and
 *  edges that were: what `readCanvas` keeps on the canvas it reads. */
export function extrasFrom(
  parsed: Fields,
  nodes: ReadonlySet<string>,
  edges: ReadonlySet<string>,
): Extras {
  const out = none()

  for (const [key, held] of Object.entries(parsed)) {
    if (!TOP_FIELDS.has(key)) out.top[key] = held
  }
  if (isRecord(parsed.nib)) out.nib = beyond(parsed.nib, NIB_FIELDS) ?? {}

  const unreadIn = (list: unknown, read: ReadonlySet<string>, known: ReadonlySet<string>) => {
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
  out.nodes = unreadIn(parsed.nodes, nodes, NODE_FIELDS)
  out.edges = unreadIn(parsed.edges, edges, EDGE_FIELDS)

  // Counted against what the file said they were when Orden last wrote it. A file with
  // no record - never written by Orden with things unread in it - starts every one at
  // the first generation.
  const record = isRecord(parsed.nib) ? parsed.nib[RECORD] : undefined
  const said = isRecord(record) ? record : {}
  const now = everyOf(out)
  for (const [name, held] of now) {
    const was = entryOf(said[name])
    // Changed since the write, back after a burial, or new beside a record.
    const changed = was === null ? isRecord(record) : was.print !== fingerprint(held)
    out.generations.set(name, (was?.generation ?? 0) + (changed ? 1 : 0))
  }
  for (const [name, entry] of Object.entries(said)) {
    if (now.has(name)) continue
    const was = entryOf(entry)
    if (!was) continue
    // Buried before, or thrown away since the write: a generation on.
    out.buried.set(name, was.print === null ? was.generation : was.generation + 1)
  }
  return out
}

/** Whether a file holds anything unread at all. */
export function holdsExtras(extras: Extras | undefined): extras is Extras {
  if (!extras) return false
  return (
    Object.keys(extras.top).length > 0 ||
    Object.keys(extras.nib).length > 0 ||
    extras.nodes.size > 0 ||
    extras.edges.size > 0 ||
    extras.fields.size > 0 ||
    extras.buried.size > 0
  )
}

/** The one of two values to keep where nothing says which is newer: the one whose
 *  written form sorts first, which is how `later` in canvas-merge.ts breaks a tie, so
 *  both devices reach the same answer. */
function either(ours: unknown, theirs: unknown): unknown {
  return JSON.stringify(ours) <= JSON.stringify(theirs) ? ours : theirs
}

/** Two files' extras as one: each unread thing at the higher generation either side
 *  has it at - a burial at a higher generation than the other side's version leaves it
 *  gone - and everything either holds kept. */
export function mergedExtras(ours: Extras = none(), theirs: Extras = none()): Extras {
  const mine = everyOf(ours)
  const yours = everyOf(theirs)
  const out = none()
  const names = new Set([
    ...mine.keys(),
    ...yours.keys(),
    ...ours.buried.keys(),
    ...theirs.buried.keys(),
  ])

  for (const name of names) {
    const one = mine.get(name)
    const other = yours.get(name)
    const oneAt = ours.generations.get(name) ?? 0
    const otherAt = theirs.generations.get(name) ?? 0
    const buried = Math.max(ours.buried.get(name) ?? -1, theirs.buried.get(name) ?? -1)

    let value: unknown
    let at: number
    if (one !== undefined && other !== undefined) {
      value = oneAt === otherAt ? either(one, other) : oneAt > otherAt ? one : other
      at = Math.max(oneAt, otherAt)
    } else {
      value = one ?? other
      at = one !== undefined ? oneAt : otherAt
    }
    // A thing thrown away goes, unless one side changed it since: then it is the newer
    // word, and stays.
    if (value === undefined || buried > at) {
      if (buried >= 0) out.buried.set(name, buried)
      continue
    }
    out.generations.set(name, at)

    const split = name.indexOf(':')
    const kind = name.slice(0, split) as Kind
    const id = name.slice(split + 1)
    if (kind === 'top') out.top[id] = value
    else if (kind === 'nib') out.nib[id] = value
    else if (isRecord(value)) {
      const map = kind === 'node' ? out.nodes : kind === 'edge' ? out.edges : out.fields
      map.set(id, value)
    }
  }
  return out
}

/** The file `text`, as `writeCanvas` wrote it, with `extras` put back into it. The text
 *  itself where there is nothing to put back, so a canvas with nothing unread in it is
 *  written exactly as it always was.
 *
 *  A node or an edge that is not in the file any more takes its own fields with it; one
 *  that does not read is kept while it is not in the file as one that does, and an edge
 *  that does not read is kept while both its ends are in the file. Unread nodes and
 *  edges go after the ones that read, in the order they came. */
export function withExtras(text: string, extras: Extras | undefined): string {
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
  for (const [key, held] of Object.entries(extras.top)) {
    if (!TOP_FIELDS.has(key)) file[key] = held
  }

  // What is unread in the file as written, recorded with its generation for the next
  // read to count against; see the top of this file.
  const written = none()
  written.top = Object.fromEntries(
    Object.entries(extras.top).filter(([key]) => !TOP_FIELDS.has(key)),
  )
  written.nib = extras.nib
  for (const [id, node] of extras.nodes) if (nodes.includes(node)) written.nodes.set(id, node)
  for (const [id, edge] of extras.edges) if (edges.includes(edge)) written.edges.set(id, edge)
  const present = new Set([...placed, ...joined])
  for (const [id, more] of extras.fields) if (present.has(id)) written.fields.set(id, more)
  const record: Fields = {}
  for (const [name, held] of everyOf(written)) {
    record[name] = `${fingerprint(held)}.${String(extras.generations.get(name) ?? 0)}`
  }
  for (const [name, generation] of extras.buried) {
    if (!(name in record)) record[name] = `~${String(generation)}`
  }
  file.nib = {
    ...(isRecord(file.nib) ? file.nib : {}),
    ...extras.nib,
    ...(Object.keys(record).length ? { [RECORD]: record } : {}),
  }

  return `${JSON.stringify(file, null, '\t')}\n`
}

/** The extras as one JSON string, the same for the same extras whatever order they were
 *  gathered in: the unread things and the fields sorted by id. What a room keeps them as
 *  (`EXTRAS` in @nib/rooms' plane.ts), compared before it is written so an edit that
 *  left them alone writes nothing. */
export function extrasText(extras: Extras): string {
  const sorted = (map: Map<string, Fields>) =>
    [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify({
    top: extras.top,
    nib: extras.nib,
    nodes: sorted(extras.nodes),
    edges: sorted(extras.edges),
    fields: sorted(extras.fields),
    generations: [...extras.generations].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    buried: [...extras.buried].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  })
}

/** The extras `extrasText` wrote, or none for text that is not that. */
export function extrasRead(text: unknown): Extras {
  if (typeof text !== 'string') return none()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return none()
  }
  if (!isRecord(parsed)) return none()
  const pairs = (value: unknown) =>
    new Map(
      (Array.isArray(value) ? value : []).filter(
        (one): one is [string, Fields] =>
          Array.isArray(one) && typeof one[0] === 'string' && isRecord(one[1]),
      ),
    )
  const counts = (value: unknown) =>
    new Map(
      (Array.isArray(value) ? value : []).filter(
        (one): one is [string, number] =>
          Array.isArray(one) && typeof one[0] === 'string' && Number.isInteger(one[1]),
      ),
    )
  return {
    top: isRecord(parsed.top) ? parsed.top : {},
    nib: isRecord(parsed.nib) ? parsed.nib : {},
    nodes: pairs(parsed.nodes),
    edges: pairs(parsed.edges),
    fields: pairs(parsed.fields),
    generations: counts(parsed.generations),
    buried: counts(parsed.buried),
  }
}
