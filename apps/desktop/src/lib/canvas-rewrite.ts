import type { Canvas } from '@orden/markdown/canvas'
import { type FoundLink, isPagesTarget } from '@orden/markdown/links'
import { paperOf } from './pages/held'
import { folderOf } from './space-paths'
import type { NoteDoc } from './workspace/documents.svelte'
import { skim, type Span } from '@orden/scan/json-skim'
import { type Move, type Placed, retargetLinks } from './link-rewrite'

export function rewriteCanvasLinks(
  text: string,
  source: string,
  move: Move,
  points: (link: FoundLink) => boolean,
): string | null {
  return retargetCanvas(
    text,
    source,
    (file) => (file === move.from ? move.to : null),
    (link) => (points(link) ? move.to : null),
  )
}

export function retargetCanvas(
  text: string,
  source: string,
  file: (path: string) => string | null,
  to: (link: FoundLink) => string | Placed | null,
  now = Date.now(),
): string | null {
  const nodes = nodeStrings(text)
  if (!nodes) return null

  const edits: Edit[] = []
  const changed: string[] = []
  for (const node of nodes) {
    const type = node.get('type')?.value
    const card = node.get('file')
    const words = node.get('text')
    const there = type === 'file' && card ? file(card.value) : null
    const id = node.get('id')?.value

    if (card && there !== null) {
      edits.push({ from: card.from, to: card.to, insert: JSON.stringify(there) })
      if (id !== undefined) changed.push(id)
    } else if (type === 'text' && words) {
      const after = retargetLinks(words.value, source, to)
      if (after !== null && after !== words.value) {
        edits.push({ from: words.from, to: words.to, insert: JSON.stringify(after) })
        if (id !== undefined) changed.push(id)
      }
    }
  }
  if (!edits.length) return null
  edits.push(...timesOf(text, changed, now))

  let out = text
  for (const edit of edits.sort((one, other) => other.from - one.from)) {
    out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to)
  }
  return out
}

export function retargetPlane(
  canvas: Canvas,
  source: string,
  file: (path: string) => string | null,
  to: (link: FoundLink) => string | Placed | null,
): Canvas {
  const nodes = canvas.nodes.map((node) => {
    if (node.type === 'file') {
      const there = file(node.file)
      return there === null ? node : { ...node, file: there }
    }
    if (node.type !== 'text') return node
    const after = retargetLinks(node.text, source, to)
    return after === null || after === node.text ? node : { ...node, text: after }
  })
  return nodes.some((node, at) => node !== canvas.nodes[at]) ? { ...canvas, nodes } : canvas
}

export function cardsMoving(
  note: string,
  moving: (path: string) => string | null,
): ((path: string) => string | null) | null {
  if (!isPagesTarget(note)) return moving
  if (folderOf(note) !== '') return null
  const own = paperOf(note)
  return (path) => {
    const there = path === own ? null : moving(path)
    return there === own ? null : there
  }
}

export async function drawnPlane(doc: NoteDoc) {
  const [{ CanvasStore }, { workspace }] = await Promise.all([
    import('./canvas/store.svelte'),
    import('./workspace.svelte'),
  ])
  return CanvasStore.drawing(doc, workspace.tabs)
}

interface Edit {
  from: number
  to: number
  insert: string
}

function timesOf(text: string, ids: readonly string[], now: number): Edit[] {
  const top = skim(text, ['orden', 'nib'])
  const own = top?.get('orden') ?? top?.get('nib')
  const at: Span | undefined = own ? skim(text, ['at'], own)?.get('at') : undefined
  const held = at ? skim(text, ids, at) : null
  if (!at || !held) return []

  const edits: Edit[] = []
  const missing: string[] = []
  for (const id of new Set(ids)) {
    const time = held.get(id)
    if (time) edits.push({ from: time.from, to: time.to, insert: String(now) })
    else missing.push(id)
  }
  if (missing.length) {
    const empty = text.slice(at.from + 1, at.to - 1).trim() === ''
    const added = missing.map((id) => `${JSON.stringify(id)}: ${now}`).join(', ')
    edits.push({ from: at.from + 1, to: at.from + 1, insert: empty ? added : `${added}, ` })
  }
  return edits
}

interface Spot {
  from: number
  to: number
  value: string
}

function nodeStrings(text: string): Map<string, Spot>[] | null {
  const nodes: Map<string, Spot>[] = []
  let at = 0

  const fail = (): never => {
    throw new SyntaxError('not JSON')
  }
  const space = () => {
    while (at < text.length && /\s/.test(text[at] ?? '')) at++
  }
  const literal = (): Spot => {
    const from = at
    if (text[at] !== '"') fail()
    at++
    while (at < text.length && text[at] !== '"') at += text[at] === '\\' ? 2 : 1
    if (at >= text.length) fail()
    at++
    return { from, to: at, value: JSON.parse(text.slice(from, at)) as string }
  }
  const object = (entry: (key: string) => void) => {
    at++
    space()
    if (text[at] === '}') {
      at++
      return
    }
    for (;;) {
      space()
      const key = literal().value
      space()
      if (text[at] !== ':') fail()
      at++
      space()
      entry(key)
      space()
      if (text[at] === ',') at++
      else if (text[at] === '}') {
        at++
        return
      } else fail()
    }
  }
  const array = (item: () => void) => {
    at++
    space()
    if (text[at] === ']') {
      at++
      return
    }
    for (;;) {
      space()
      item()
      space()
      if (text[at] === ',') at++
      else if (text[at] === ']') {
        at++
        return
      } else fail()
    }
  }
  const value = (): void => {
    const first = text[at]
    if (first === '{') object(() => value())
    else if (first === '[') array(() => value())
    else if (first === '"') literal()
    else {
      const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at))
      if (!match) fail()
      at += match?.[0].length ?? 0
    }
  }
  const node = () => {
    if (text[at] !== '{') {
      value()
      return
    }
    const strings = new Map<string, Spot>()
    object((key) => {
      if (text[at] === '"') strings.set(key, literal())
      else value()
    })
    nodes.push(strings)
  }

  try {
    space()
    if (text[at] !== '{') return null
    object((key) => {
      if (key === 'nodes' && text[at] === '[') array(node)
      else value()
    })
    space()
    return at === text.length ? nodes : null
  } catch {
    return null
  }
}
