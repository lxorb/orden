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

const ORDEN_FIELDS = new Set([
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
  'moved',
  'outside',
])

const RECORD = 'outside'

type Fields = Record<string, unknown>

export interface Extras {
  top: Fields
  nib: Fields
  nodes: Map<string, Fields>
  edges: Map<string, Fields>
  ink: Map<string, Fields>
  shapes: Map<string, Fields>
  fields: Map<string, Fields>
  generations: Map<string, number>
  buried: Map<string, number>
}

type Kind = 'node' | 'edge' | 'ink' | 'shape' | 'field' | 'top' | 'nib'

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
    ink: new Map(),
    shapes: new Map(),
    fields: new Map(),
    generations: new Map(),
    buried: new Map(),
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function fingerprint(value: unknown): string {
  let hash = 0x811c9dc5
  const text = canonical(value)
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

function everyOf(extras: Extras): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [key, held] of Object.entries(extras.top)) out.set(named('top', key), held)
  for (const [key, held] of Object.entries(extras.nib)) out.set(named('nib', key), held)
  for (const [id, held] of extras.nodes) out.set(named('node', id), held)
  for (const [id, held] of extras.edges) out.set(named('edge', id), held)
  for (const [id, held] of extras.ink) out.set(named('ink', id), held)
  for (const [id, held] of extras.shapes) out.set(named('shape', id), held)
  for (const [id, held] of extras.fields) out.set(named('field', id), held)
  return out
}

function entryOf(entry: unknown): { print: string | null; generation: number } | null {
  if (typeof entry !== 'string') return null
  const buried = entry.startsWith('~')
  const at = entry.lastIndexOf('.')
  const generation = Number(buried ? entry.slice(1) : entry.slice(at + 1))
  if (!Number.isInteger(generation) || generation < 0) return null
  if (buried) return { print: null, generation }
  return at > 0 ? { print: entry.slice(0, at), generation } : null
}

export function noExtras(): Extras {
  return none()
}

export function extrasFrom(
  parsed: Fields,
  nodes: ReadonlySet<string>,
  edges: ReadonlySet<string>,
  ink: ReadonlySet<string> = new Set(),
): Extras {
  const out = none()

  for (const [key, held] of Object.entries(parsed)) {
    if (!TOP_FIELDS.has(key)) out.top[key] = held
  }
  if (isRecord(parsed.nib)) out.nib = beyond(parsed.nib, ORDEN_FIELDS) ?? {}

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
  if (isRecord(parsed.nib)) {
    out.ink = unreadOnly(parsed.nib.ink, ink)
    out.shapes = unreadOnly(parsed.nib.shapes, nodes)
  }

  const record = isRecord(parsed.nib) ? parsed.nib[RECORD] : undefined
  const said = isRecord(record) ? record : {}
  const now = everyOf(out)
  for (const [name, held] of now) {
    const was = entryOf(said[name])
    const changed = was === null ? isRecord(record) : was.print !== fingerprint(held)
    out.generations.set(name, (was?.generation ?? 0) + (changed ? 1 : 0))
  }
  for (const [name, entry] of Object.entries(said)) {
    if (now.has(name)) continue
    const was = entryOf(entry)
    if (!was) continue
    out.buried.set(name, was.print === null ? was.generation : was.generation + 1)
  }
  return out
}

function unreadOnly(list: unknown, read: ReadonlySet<string>): Map<string, Fields> {
  const unread = new Map<string, Fields>()
  if (!Array.isArray(list)) return unread
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const id = idOf(entry)
    if (id !== null && !read.has(id) && !unread.has(id)) unread.set(id, entry)
  }
  return unread
}

export function holdsExtras(extras: Extras | undefined): extras is Extras {
  if (!extras) return false
  return (
    Object.keys(extras.top).length > 0 ||
    Object.keys(extras.nib).length > 0 ||
    extras.nodes.size > 0 ||
    extras.edges.size > 0 ||
    extras.ink.size > 0 ||
    extras.shapes.size > 0 ||
    extras.fields.size > 0 ||
    extras.buried.size > 0
  )
}

function either(ours: unknown, theirs: unknown): unknown {
  return JSON.stringify(ours) <= JSON.stringify(theirs) ? ours : theirs
}

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
      mapOf(out, kind).set(id, value)
    }
  }
  return out
}

function mapOf(extras: Extras, kind: Kind): Map<string, Fields> {
  if (kind === 'node') return extras.nodes
  if (kind === 'edge') return extras.edges
  if (kind === 'ink') return extras.ink
  if (kind === 'shape') return extras.shapes
  return extras.fields
}

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

  const own = isRecord(file.nib) ? file.nib : {}
  const kept = { ink: extras.ink, shapes: extras.shapes }
  for (const [key, unread] of Object.entries(kept)) {
    if (!unread.size) continue
    const list = Array.isArray(own[key]) ? (own[key] as Fields[]) : []
    const there = new Set(list.map((one) => idOf(one)))
    for (const [id, entry] of unread) if (!there.has(id)) list.push(entry)
    own[key] = list
  }
  if (Object.keys(own).length) file.nib = own
  for (const [key, held] of Object.entries(extras.top)) {
    if (!TOP_FIELDS.has(key)) file[key] = held
  }

  const written = none()
  written.top = Object.fromEntries(
    Object.entries(extras.top).filter(([key]) => !TOP_FIELDS.has(key)),
  )
  written.nib = extras.nib
  for (const [id, node] of extras.nodes) if (nodes.includes(node)) written.nodes.set(id, node)
  for (const [id, edge] of extras.edges) if (edges.includes(edge)) written.edges.set(id, edge)
  written.ink = extras.ink
  written.shapes = extras.shapes
  const present = new Set([...placed, ...joined])
  for (const [id, more] of extras.fields) if (present.has(id)) written.fields.set(id, more)
  const record: Fields = {}
  for (const [name, held] of everyOf(written)) {
    record[name] = `${fingerprint(held)}.${String(extras.generations.get(name) ?? 0)}`
  }
  for (const [name, generation] of extras.buried) {
    if (!(name in record)) record[name] = `~${String(generation)}`
  }
  const nib = {
    ...(isRecord(file.nib) ? file.nib : {}),
    ...extras.nib,
    ...(Object.keys(record).length ? { [RECORD]: record } : {}),
  }
  if (Object.keys(nib).length) file.nib = nib
  else delete file.nib

  return `${JSON.stringify(file, null, '\t')}\n`
}

export function extrasText(extras: Extras): string {
  const sorted = (map: Map<string, Fields>) =>
    [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify({
    top: extras.top,
    nib: extras.nib,
    nodes: sorted(extras.nodes),
    edges: sorted(extras.edges),
    ink: sorted(extras.ink),
    shapes: sorted(extras.shapes),
    fields: sorted(extras.fields),
    generations: [...extras.generations].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    buried: [...extras.buried].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  })
}

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
    ink: pairs(parsed.ink),
    shapes: pairs(parsed.shapes),
    fields: pairs(parsed.fields),
    generations: counts(parsed.generations),
    buried: counts(parsed.buried),
  }
}
